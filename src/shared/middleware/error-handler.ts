import type { ErrorRequestHandler } from 'express'

import { AppError } from '../errors/app-error.js'

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    })
    return
  }

  console.error('Unhandled server error', error instanceof Error ? error.message : 'Unknown error')
  response.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.',
  })
}
