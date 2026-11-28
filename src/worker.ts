import 'dotenv/config'

import { connectDatabase, disconnectDatabase } from '@/config/database.js'
import { env } from '@/config/env.js'
import { startGoogleSyncWorker } from '@/jobs/google-sync-runner.js'

const startWorkerProcess = async (): Promise<void> => {
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is required')
  }

  await connectDatabase(env.mongoUri)
  const worker = startGoogleSyncWorker({ concurrency: 3 })
  console.info(`EduTrack Google Sync Worker (${worker.workerId}) started`)

  const shutdown = (signal: NodeJS.Signals): void => {
    console.info(`[Worker] Received ${signal}, draining active Google sync jobs...`)
    void worker
      .stop()
      .catch((error: unknown) => {
        console.error('[Worker] Error during graceful stop:', error instanceof Error ? error.message : 'Unknown error')
      })
      .finally(() => {
        void disconnectDatabase().finally(() => process.exit(0))
      })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Worker Process] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (error: Error) => {
  console.error('[Worker Process] Uncaught Exception:', error)
})

void startWorkerProcess().catch((error: unknown) => {
  console.error('Unable to start EduTrack Worker', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
})
