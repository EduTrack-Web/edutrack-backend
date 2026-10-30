import 'dotenv/config'

import type { Server } from 'node:http'

import { createApp } from './app.js'
import { connectDatabase, disconnectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { seedDevelopmentUsers } from './config/seed.js'

const startServer = async (): Promise<void> => {
  if (!env.mongoUri) {
    throw new Error('MONGODB_URI is required')
  }

  await connectDatabase(env.mongoUri)
  await seedDevelopmentUsers()
  const app = createApp()
  let server: Server

  server = app.listen(env.port, () => {
    console.info(`EduTrack API is listening on port ${env.port}`)
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    console.info(`Received ${signal}, shutting down`)
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0))
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void startServer().catch((error: unknown) => {
  console.error('Unable to start EduTrack API', error instanceof Error ? error.message : 'Unknown error')
  process.exit(1)
})
