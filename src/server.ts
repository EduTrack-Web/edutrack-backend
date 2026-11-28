import 'dotenv/config'

import { createServer } from 'node:http'

import { createApp } from '@/app.js'
import { connectDatabase, disconnectDatabase } from '@/config/database.js'
import { env } from '@/config/env.js'
import { seedDevelopmentUsers } from '@/config/seed.js'
import { startGoogleSyncScheduler } from '@/jobs/google-sync-scheduler.js'
import { startReminderScheduler } from '@/jobs/reminder-scheduler.js'
import {
  CHAT_SOCKET_SERVER_KEY,
  createChatSocketServer,
} from '@/modules/chat/realtime/chat.realtime.js'

const startServer = async (): Promise<void> => {
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is required')
  }

  await connectDatabase(env.mongoUri)
  await seedDevelopmentUsers()
  const app = createApp()
  const server = createServer(app)
  const chatSocketServer = createChatSocketServer(server)
  app.set(CHAT_SOCKET_SERVER_KEY, chatSocketServer)

  server.listen(env.port, () => {
    console.info(`EduTrack API is listening on port ${env.port}`)
  })

  const reminderTimer = startReminderScheduler()
  const googleSyncWorker = env.runEmbeddedWorker ? startGoogleSyncScheduler() : null

  const shutdown = (signal: NodeJS.Signals): void => {
    console.info(`Received ${signal}, shutting down`)
    clearInterval(reminderTimer)
    chatSocketServer.disconnectSockets(true)
    server.close(() => {
      chatSocketServer.close()
      const stopWorker = googleSyncWorker ? googleSyncWorker.stop() : Promise.resolve()
      void stopWorker.finally(() => {
        void disconnectDatabase().finally(() => process.exit(0))
      })
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[Process] Unhandled Rejection:', reason)
})

process.on('uncaughtException', (error: Error) => {
  console.error('[Process] Uncaught Exception:', error)
})

void startServer().catch((error: unknown) => {
  console.error('Unable to start EduTrack API', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
})
