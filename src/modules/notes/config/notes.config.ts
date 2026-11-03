export const NOTE_DEFAULT_TITLE = 'Ghi chú không tiêu đề'
export const NOTE_TITLE_MAX_LENGTH = 200
export const NOTE_CONTENT_MAX_BYTES = 500 * 1024
export const NOTE_CONTENT_MAX_DEPTH = 20
export const NOTE_CONTENT_MAX_NODES = 10_000

export const NOTE_IMAGE_MAX_SIZE_MB = 5
export const NOTE_IMAGE_MAX_SIZE_BYTES = NOTE_IMAGE_MAX_SIZE_MB * 1024 * 1024
export const NOTE_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const NOTE_IMAGE_ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const

export const NOTE_IMAGE_ERROR_MESSAGES = {
  tooLarge: `Dung lượng ảnh không được vượt quá ${NOTE_IMAGE_MAX_SIZE_MB} MB.`,
  unsupportedType: 'Ảnh phải có định dạng JPEG, PNG hoặc WebP.',
  invalidContent: 'Nội dung tệp không khớp với định dạng ảnh được hỗ trợ.',
} as const

export type NoteImageMimeType = (typeof NOTE_IMAGE_ALLOWED_MIME_TYPES)[number]
export type NoteImageFormat = (typeof NOTE_IMAGE_ALLOWED_FORMATS)[number]
