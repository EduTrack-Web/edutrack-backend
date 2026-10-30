import { randomBytes, timingSafeEqual } from 'node:crypto'

import type { RequestHandler } from 'express'

import { env } from '../../config/env.js'
import { AppError } from '../errors/app-error.js'

export const CSRF_COOKIE = 'edutrack_csrf'

export const issueCsrfToken: RequestHandler = (_request, response) => {
  const token = randomBytes(32).toString('base64url')
  response.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: env.nodeEnv === 'production',
    sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
    maxAge: 2 * 60 * 60 * 1000,
    path: '/',
  })
  response.json({ success: true, data: { csrfToken: token } })
}

export const requireCsrf: RequestHandler = (request, _response, next) => {
  const cookieToken = request.cookies[CSRF_COOKIE]
  const headerToken = request.header('x-csrf-token')
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') {
    next(new AppError(403, 'CSRF_TOKEN_MISSING', 'Yêu cầu bảo mật không hợp lệ.'))
    return
  }
  const left = Buffer.from(cookieToken)
  const right = Buffer.from(headerToken)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    next(new AppError(403, 'CSRF_TOKEN_INVALID', 'Yêu cầu bảo mật không hợp lệ.'))
    return
  }
  next()
}
