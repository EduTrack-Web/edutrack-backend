import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '@/shared/errors/app-error.js'
import { NOTE_IMAGE_MAX_SIZE_BYTES } from '@/modules/notes/config/notes.config.js'
import { noteImageService } from '@/modules/notes/services/note-image.service.js'

test('keeps the configured image limit at exactly 5 MB', () => {
  assert.equal(NOTE_IMAGE_MAX_SIZE_BYTES, 5 * 1024 * 1024)
})

test('rejects an unsupported declared image type before upload', async () => {
  await assert.rejects(
    noteImageService.upload({ buffer: Buffer.from('GIF89a'), mimetype: 'image/gif', size: 6 }, 'user-id'),
    (error: unknown) => error instanceof AppError && error.code === 'IMAGE_TYPE_NOT_SUPPORTED',
  )
})

test('rejects a file whose actual signature does not match its MIME type', async () => {
  const jpegSignature = Buffer.from([0xff, 0xd8, 0xff, 0x00])
  await assert.rejects(
    noteImageService.upload({ buffer: jpegSignature, mimetype: 'image/png', size: jpegSignature.length }, 'user-id'),
    (error: unknown) => error instanceof AppError && error.code === 'IMAGE_CONTENT_INVALID',
  )
})
