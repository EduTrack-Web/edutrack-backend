import type { RequestHandler } from 'express'
import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import { notificationService } from '../services/notification.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

export const getNotifications: RequestHandler = async (_request, response) => {
  const userId = userIdFrom(response.locals)
  const result = await notificationService.getNotifications(userId)
  response.json({
    success: true,
    data: result,
  })
}

export const markAsRead: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { notificationId } = request.params
  const notification = await notificationService.markAsRead(
    userId,
    typeof notificationId === 'string' ? notificationId : '',
  )
  response.json({
    success: true,
    data: { notification },
    message: 'Đã đánh dấu thông báo là đã đọc.',
  })
}

export const markAllAsRead: RequestHandler = async (_request, response) => {
  const userId = userIdFrom(response.locals)
  await notificationService.markAllAsRead(userId)
  response.json({
    success: true,
    data: null,
    message: 'Đã đánh dấu tất cả thông báo là đã đọc.',
  })
}

export const deleteNotification: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { notificationId } = request.params
  await notificationService.deleteNotification(
    userId,
    typeof notificationId === 'string' ? notificationId : '',
  )
  response.json({
    success: true,
    data: null,
    message: 'Đã xóa thông báo.',
  })
}
