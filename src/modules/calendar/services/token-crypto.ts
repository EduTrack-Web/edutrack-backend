import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

const resolveEncryptionKey = (): Buffer => {
  const material =
    env.googleTokenEncryptionKey || env.jwtAccessSecret || env.googleClientSecret
  if (!material) {
    if (env.nodeEnv === 'production') {
      throw new AppError(
        500,
        'SERVER_MISCONFIGURED',
        'Thiếu khóa mã hóa token đồng bộ Google Lịch trên máy chủ.',
      )
    }
    return createHash('sha256').update('google-calendar-token:edutrack-dev-fallback-key').digest()
  }
  return createHash('sha256').update(`google-calendar-token:${material}`).digest()
}

export const encryptToken = (plaintext: string): string => {
  if (!plaintext) return ''
  const key = resolveEncryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export const decryptToken = (payload: string): string => {
  if (!payload) return ''
  const parts = payload.split('.')
  if (parts.length !== 3) return ''
  const [ivRaw, tagRaw, dataRaw] = parts
  if (!ivRaw || !tagRaw || !dataRaw) return ''

  try {
    const key = resolveEncryptionKey()
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, 'base64url')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch {
    return ''
  }
}
