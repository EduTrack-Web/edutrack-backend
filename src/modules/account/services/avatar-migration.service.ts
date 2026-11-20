import { isCloudinaryConfigured } from '@/shared/config/cloudinary.config.js'
import { AppError } from '@/shared/errors/app-error.js'
import { avatarStorageService, isGoogleHostedAvatarUrl } from '@/shared/services/avatar-storage.service.js'
import { accountRepository } from '@/modules/account/repositories/account.repository.js'

interface AvatarMigrationResult {
  migrated: number
  cleared: number
  skipped: number
}

export const avatarMigrationService = {
  async migrateLegacyGoogleAvatars(): Promise<AvatarMigrationResult> {
    if (!isCloudinaryConfigured) {
      throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Dịch vụ lưu ảnh chưa được cấu hình.')
    }

    const result: AvatarMigrationResult = { migrated: 0, cleared: 0, skipped: 0 }
    const users = accountRepository.findUsersWithLegacyGoogleAvatar()

    for await (const user of users) {
      const currentAvatarUrl = user.avatarUrl
      if (!currentAvatarUrl || !isGoogleHostedAvatarUrl(currentAvatarUrl)) {
        result.skipped += 1
        continue
      }

      const storedAvatarUrl = await avatarStorageService.importGoogleAvatar(String(user._id), currentAvatarUrl)
      await accountRepository.setAvatarUrl(String(user._id), storedAvatarUrl)

      if (storedAvatarUrl) {
        result.migrated += 1
      } else {
        result.cleared += 1
      }
    }

    return result
  },
}
