import { Readable } from 'node:stream'

import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'

import { env } from '../../../config/env.js'
import { AppError } from '../../../shared/errors/app-error.js'
import {
  NOTE_IMAGE_ALLOWED_FORMATS,
  NOTE_IMAGE_ALLOWED_MIME_TYPES,
  NOTE_IMAGE_ERROR_MESSAGES,
  type NoteImageFormat,
  type NoteImageMimeType,
} from '../config/notes.config.js'
import type { NoteImageUploadResult } from '../types/notes.types.js'

interface UploadedImage {
  buffer: Buffer
  mimetype: string
  size: number
}

const detectImageFormat = (buffer: Buffer): NoteImageFormat | undefined => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp'
  }
  return undefined
}

const mimeForFormat: Record<NoteImageFormat, NoteImageMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const requireCloudinaryConfig = (): void => {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new AppError(503, 'IMAGE_UPLOAD_NOT_CONFIGURED', 'Dịch vụ tải ảnh chưa được cấu hình.')
  }
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  })
}

const uploadBuffer = async (file: UploadedImage, userId: string): Promise<UploadApiResponse> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `edutrack/notes/${userId}`,
        resource_type: 'image',
        allowed_formats: [...NOTE_IMAGE_ALLOWED_FORMATS],
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary returned no upload result'))
          return
        }
        resolve(result)
      },
    )
    Readable.from(file.buffer).pipe(stream)
  })

export const noteImageService = {
  async upload(file: UploadedImage | undefined, userId: string): Promise<NoteImageUploadResult> {
    if (!file) {
      throw new AppError(422, 'IMAGE_REQUIRED', 'Vui lòng chọn ảnh để tải lên.', { image: 'Vui lòng chọn ảnh.' })
    }
    if (!NOTE_IMAGE_ALLOWED_MIME_TYPES.includes(file.mimetype as NoteImageMimeType)) {
      throw new AppError(415, 'IMAGE_TYPE_NOT_SUPPORTED', NOTE_IMAGE_ERROR_MESSAGES.unsupportedType)
    }
    const detectedFormat = detectImageFormat(file.buffer)
    if (!detectedFormat || mimeForFormat[detectedFormat] !== file.mimetype) {
      throw new AppError(415, 'IMAGE_CONTENT_INVALID', NOTE_IMAGE_ERROR_MESSAGES.invalidContent)
    }

    requireCloudinaryConfig()
    try {
      const result = await uploadBuffer(file, userId)
      if (!NOTE_IMAGE_ALLOWED_FORMATS.includes(result.format as NoteImageFormat)) {
        throw new Error('Cloudinary returned an unsupported image format')
      }
      return {
        src: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format as NoteImageFormat,
      }
    } catch {
      throw new AppError(502, 'IMAGE_UPLOAD_FAILED', 'Không thể tải ảnh lên lúc này. Vui lòng thử lại.')
    }
  },
}
