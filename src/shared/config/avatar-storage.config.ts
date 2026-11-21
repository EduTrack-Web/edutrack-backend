export const AVATAR_CLOUDINARY_FOLDER = 'edutrack/avatars'
export const AVATAR_IMAGE_SIZE_PX = 400

export const buildAvatarPublicId = (userId: string): string => `user_${userId}`
