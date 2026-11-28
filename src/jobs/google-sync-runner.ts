import { randomUUID } from 'node:crypto'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import { googleCalendarSyncService } from '@/modules/calendar/services/google-calendar-sync.service.js'

const WORKER_POLL_INTERVAL_MS = 3_000
const SCHEDULER_TICK_INTERVAL_MS = 30_000
const JOB_LEASE_DURATION_MS = 3 * 60 * 1000
const DEFAULT_WORKER_CONCURRENCY = 3

let activeWakeupHandler: (() => void) | null = null

export const wakeUpGoogleSyncWorker = (): void => {
  activeWakeupHandler?.()
}

export interface GoogleSyncWorkerHandle {
  workerId: string
  stop: () => Promise<void>
}

export const startGoogleSyncWorker = (options?: {
  concurrency?: number
}): GoogleSyncWorkerHandle => {
  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? DEFAULT_WORKER_CONCURRENCY, 5))
  const inFlightJobs = new Set<Promise<void>>()
  let isStopping = false
  let isScheduling = false
  let isDraining = false

  const drainQueue = (): void => {
    if (isStopping || isDraining) return
    isDraining = true

    void (async () => {
      try {
        while (!isStopping && inFlightJobs.size < concurrency) {
          const claimed = await googleCalendarRepository.claimNextDueJob(
            workerId,
            new Date(),
            JOB_LEASE_DURATION_MS,
          )
          if (!claimed) break

          const task = googleCalendarSyncService
            .processClaimedJob(claimed._id, workerId)
            .catch((error: unknown) => {
              console.error(
                `[GoogleSyncWorker:${workerId}] Job ${String(claimed._id)} failed unexpectedly:`,
                error instanceof Error ? error.message : 'Unknown error',
              )
            })
            .finally(() => {
              inFlightJobs.delete(task)
              if (!isStopping) {
                drainQueue()
              }
            })

          inFlightJobs.add(task)
        }
      } catch (error: unknown) {
        console.error(
          `[GoogleSyncWorker:${workerId}] Drain error:`,
          error instanceof Error ? error.message : 'Unknown error',
        )
      } finally {
        isDraining = false
      }
    })()
  }

  const runSchedulerTick = (): void => {
    if (isStopping || isScheduling) return
    isScheduling = true

    void googleCalendarSyncService
      .scheduleDueIncrementalSyncs()
      .then(() => {
        if (!isStopping) drainQueue()
      })
      .catch((error: unknown) => {
        console.error(
          `[GoogleSyncWorker:${workerId}] Scheduler tick error:`,
          error instanceof Error ? error.message : 'Unknown error',
        )
      })
      .finally(() => {
        isScheduling = false
      })
  }

  activeWakeupHandler = () => {
    if (!isStopping) drainQueue()
  }

  const pollTimer = setInterval(drainQueue, WORKER_POLL_INTERVAL_MS)
  const schedulerTimer = setInterval(runSchedulerTick, SCHEDULER_TICK_INTERVAL_MS)
  runSchedulerTick()

  return {
    workerId,
    stop: async () => {
      isStopping = true
      activeWakeupHandler = null
      clearInterval(pollTimer)
      clearInterval(schedulerTimer)
      if (inFlightJobs.size > 0) {
        await Promise.allSettled([...inFlightJobs])
      }
      await googleCalendarRepository.releaseWorkerLeases(workerId).catch(() => undefined)
    },
  }
}
