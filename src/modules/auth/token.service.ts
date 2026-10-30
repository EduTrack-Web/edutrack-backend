import { createHash, randomBytes } from 'node:crypto'

import jwt from 'jsonwebtoken'

import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors/app-error.js'

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const getAccessSecret = (): string => {
  if (!env.jwtAccessSecret) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Dịch vụ xác thực chưa được cấu hình.')
  }
  return env.jwtAccessSecret
}

export const createAccessToken = (userId: string, role: string): string =>
  jwt.sign({ role }, getAccessSecret(), { subject: userId, expiresIn: '15m', issuer: 'edutrack' })

export const verifyAccessToken = (token: string): { userId: string; role: string } => {
  const payload = jwt.verify(token, getAccessSecret(), { issuer: 'edutrack' })
  if (typeof payload === 'string' || !payload.sub || typeof payload.role !== 'string') {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'Phiên đăng nhập không hợp lệ.')
  }
  return { userId: payload.sub, role: payload.role }
}

export const createRefreshToken = (): string => randomBytes(48).toString('base64url')
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
export const accessMaxAge = ACCESS_MAX_AGE_MS
export const refreshMaxAge = REFRESH_MAX_AGE_MS
