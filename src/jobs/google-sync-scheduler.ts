import {
  startGoogleSyncWorker,
  wakeUpGoogleSyncWorker,
  type GoogleSyncWorkerHandle,
} from '@/jobs/google-sync-runner.js'

export { wakeUpGoogleSyncWorker }
export type { GoogleSyncWorkerHandle }

export const startGoogleSyncScheduler = (): GoogleSyncWorkerHandle => {
  return startGoogleSyncWorker({ concurrency: 3 })
}
