import type { RequestHandler } from 'express'
import multer from 'multer'

import { AppError } from '../../../shared/errors/app-error.js'
import { NOTE_IMAGE_ERROR_MESSAGES, NOTE_IMAGE_MAX_SIZE_BYTES } from '../config/notes.config.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: NOTE_IMAGE_MAX_SIZE_BYTES, files: 1 },
})

export const uploadNoteImage: RequestHandler = (request, response, next) => {
  upload.single('image')(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(413, 'IMAGE_TOO_LARGE', NOTE_IMAGE_ERROR_MESSAGES.tooLarge, {
        image: NOTE_IMAGE_ERROR_MESSAGES.tooLarge,
      }))
      return
    }
    if (error) {
      next(new AppError(400, 'IMAGE_UPLOAD_REQUEST_INVALID', 'Yêu cầu tải ảnh không hợp lệ.'))
      return
    }
    next()
  })
}
