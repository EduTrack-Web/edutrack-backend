import 'dotenv/config'

import { connectDatabase, disconnectDatabase } from '@/config/database.js'
import { env } from '@/config/env.js'
import { notesService } from '@/modules/notes/services/notes.service.js'

const purgeExpiredNotes = async (): Promise<void> => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is required')
  await connectDatabase(env.mongoUri)
  try {
    const result = await notesService.purgeExpiredNotes()
    console.info(`Expired note cleanup completed: ${result.deleted} deleted, ${result.failed} failed`)
    if (result.failed > 0) process.exitCode = 1
  } finally {
    await disconnectDatabase()
  }
}

void purgeExpiredNotes().catch((error: unknown) => {
  console.error('Unable to purge expired notes', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
})
