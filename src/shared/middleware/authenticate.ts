import type { RequestHandler } from 'express'

import { AppError } from '../errors/app-error.js'
import { verifyAccessToken } from '../../modules/auth/token.service.js'

export interface AuthenticatedRequestLocals {
  userId: string
  role: string
}

export const authenticate: RequestHandler = (request, response, next) => {
  const token = request.cookies.edutrack_access
  if (typeof token !== 'string') {
    next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.'))
    return
  }
  try {
    const payload = verifyAccessToken(token)
    response.locals.auth = payload satisfies AuthenticatedRequestLocals
    next()
  } catch {
    next(new AppError(401, 'INVALID_ACCESS_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'))
  }
}
