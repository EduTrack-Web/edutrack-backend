import { Readable } from 'node:stream'

import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'

import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'
import {
  NOTE_IMAGE_ALLOWED_FORMATS,
  NOTE_IMAGE_ALLOWED_MIME_TYPES,
  NOTE_IMAGE_ERROR_MESSAGES,
  type NoteImageFormat,
  type NoteImageMimeType,
} from '@/modules/notes/config/notes.config.js'
import type { NoteContentNode, NoteImageUploadResult } from '@/modules/notes/types/notes.types.js'

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

  async destroyMany(publicIds: readonly string[]): Promise<void> {
    if (publicIds.length === 0) return
    requireCloudinaryConfig()
    try {
      await Promise.all(publicIds.map((publicId) => cloudinary.uploader.destroy(publicId, {
        invalidate: true,
        resource_type: 'image',
      })))
    } catch {
      throw new AppError(502, 'NOTE_IMAGE_CLEANUP_FAILED', 'Không thể xóa hình ảnh của ghi chú lúc này.')
    }
  },

  async duplicateContent(content: NoteContentNode, userId: string): Promise<{
    content: NoteContentNode
    createdPublicIds: string[]
  }> {
    const createdPublicIds: string[] = []
    const duplicateNode = async (node: NoteContentNode): Promise<NoteContentNode> => {
      if (node.type === 'image') {
        const src = node.attrs?.src
        if (typeof src !== 'string') throw new AppError(422, 'INVALID_NOTE_CONTENT', 'Nội dung ghi chú không hợp lệ.')
        requireCloudinaryConfig()
        const result = await cloudinary.uploader.upload(src, {
          folder: `edutrack/notes/${userId}`,
          resource_type: 'image',
          allowed_formats: [...NOTE_IMAGE_ALLOWED_FORMATS],
        })
        if (!NOTE_IMAGE_ALLOWED_FORMATS.includes(result.format as NoteImageFormat)) {
          throw new Error('Cloudinary returned an unsupported image format')
        }
        createdPublicIds.push(result.public_id)
        return {
          ...node,
          attrs: {
            ...node.attrs,
            src: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
          },
        }
      }
      if (!node.content) return node
      return { ...node, content: await Promise.all(node.content.map(duplicateNode)) }
    }

    try {
      return { content: await duplicateNode(content), createdPublicIds }
    } catch {
      try {
        await this.destroyMany(createdPublicIds)
      } catch {
        // Cleanup will be retried operationally if Cloudinary is temporarily unavailable.
      }
      throw new AppError(502, 'NOTE_DUPLICATE_IMAGE_FAILED', 'Không thể sao chép hình ảnh của ghi chú.')
    }
  },
}
