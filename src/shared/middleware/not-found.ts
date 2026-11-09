import type { RequestHandler } from 'express'

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    success: false,
    code: 'ROUTE_NOT_FOUND',
    message: `Không tìm thấy ${request.method} ${request.originalUrl}.`,
  })
}
