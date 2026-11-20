import 'dotenv/config'

import { connectDatabase, disconnectDatabase } from '@/config/database.js'
import { env } from '@/config/env.js'
import { avatarMigrationService } from '@/modules/account/services/avatar-migration.service.js'

const migrateGoogleAvatars = async (): Promise<void> => {
  if (!env.mongoUri) throw new Error('MONGODB_URI is required')
  await connectDatabase(env.mongoUri)

  try {
    const result = await avatarMigrationService.migrateLegacyGoogleAvatars()
    console.info(
      `Google avatar migration completed: ${result.migrated} migrated, ${result.cleared} cleared, ${result.skipped} skipped`,
    )
  } finally {
    await disconnectDatabase()
  }
}

void migrateGoogleAvatars().catch((error: unknown) => {
  console.error('Unable to migrate Google avatars', error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
})
