import { AVATAR_CLOUDINARY_FOLDER, AVATAR_IMAGE_SIZE_PX, buildAvatarPublicId } from '@/shared/config/avatar-storage.config.js'
import { cloudinary, isCloudinaryConfigured } from '@/shared/config/cloudinary.config.js'
import { AppError } from '@/shared/errors/app-error.js'

const uploadOptions = (userId: string) => ({
  folder: AVATAR_CLOUDINARY_FOLDER,
  public_id: buildAvatarPublicId(userId),
  overwrite: true,
  invalidate: true,
  resource_type: 'image' as const,
  transformation: [
    {
      width: AVATAR_IMAGE_SIZE_PX,
      height: AVATAR_IMAGE_SIZE_PX,
      crop: 'fill',
      gravity: 'face',
      fetch_format: 'auto',
      quality: 'auto',
    },
  ],
})

export const isGoogleHostedAvatarUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:'
      && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))
  } catch {
    return false
  }
}

export const shouldImportGoogleAvatar = (
  currentAvatarUrl: string | null | undefined,
  googleAvatarUrl: string | null | undefined,
): googleAvatarUrl is string => Boolean(
  googleAvatarUrl
  && isGoogleHostedAvatarUrl(googleAvatarUrl)
  && (!currentAvatarUrl || isGoogleHostedAvatarUrl(currentAvatarUrl)),
)

export const avatarStorageService = {
  isConfigured: isCloudinaryConfigured,

  async uploadBuffer(userId: string, buffer: Buffer): Promise<string> {
    if (!isCloudinaryConfigured) {
      throw new AppError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Dịch vụ lưu ảnh chưa được cấu hình.')
    }

    return new Promise<string>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions(userId), (error, result) => {
        if (error || !result) {
          reject(new AppError(502, 'CLOUDINARY_UPLOAD_FAILED', 'Không thể tải ảnh lên Cloudinary lúc này.'))
          return
        }
        resolve(result.secure_url)
      })

      uploadStream.end(buffer)
    })
  },

  async importGoogleAvatar(userId: string, sourceUrl: string): Promise<string | undefined> {
    if (!isCloudinaryConfigured || !isGoogleHostedAvatarUrl(sourceUrl)) {
      return undefined
    }

    try {
      const result = await cloudinary.uploader.upload(sourceUrl, uploadOptions(userId))
      return result.secure_url
    } catch {
      return undefined
    }
  },
}
