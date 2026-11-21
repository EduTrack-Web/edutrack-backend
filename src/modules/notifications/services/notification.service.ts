import { notificationRepository } from '../repositories/notification.repository.js'
import type { CreateNotificationInput, NotificationResponse } from '../types/notification.types.js'
import { AppError } from '@/shared/errors/app-error.js'

interface RawNotificationDoc {
  _id: unknown
  userId: unknown
  type: NotificationResponse['type']
  title: string
  message: string
  link?: string
  isRead: boolean
  eventId?: unknown
  metadata?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

const mapNotificationResponse = (doc: RawNotificationDoc): NotificationResponse => ({
  id: String(doc._id),
  userId: String(doc.userId),
  type: doc.type,
  title: doc.title,
  message: doc.message,
  link: doc.link || '',
  isRead: Boolean(doc.isRead),
  eventId: doc.eventId ? String(doc.eventId) : null,
  metadata: doc.metadata ?? {},
  createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
  updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
})

export const notificationService = {
  getNotifications: async (
    userId: string,
  ): Promise<{ notifications: NotificationResponse[]; unreadCount: number }> => {
    const [docs, unreadCount] = await Promise.all([
      notificationRepository.findByUserId(userId),
      notificationRepository.countUnreadByUserId(userId),
    ])

    return {
      notifications: docs.map((doc) => mapNotificationResponse(doc as unknown as RawNotificationDoc)),
      unreadCount,
    }
  },

  markAsRead: async (userId: string, notificationId: string): Promise<NotificationResponse> => {
    const updated = await notificationRepository.markAsRead(userId, notificationId)
    if (!updated) {
      throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo yêu cầu.')
    }
    return mapNotificationResponse(updated as unknown as RawNotificationDoc)
  },

  markAllAsRead: async (userId: string): Promise<void> => {
    await notificationRepository.markAllAsRead(userId)
  },

  deleteNotification: async (userId: string, notificationId: string): Promise<void> => {
    const deleted = await notificationRepository.deleteNotification(userId, notificationId)
    if (!deleted) {
      throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo yêu cầu.')
    }
  },

  createNotification: async (data: CreateNotificationInput): Promise<NotificationResponse | null> => {
    try {
      const created = await notificationRepository.create(data)
      return mapNotificationResponse(created as unknown as RawNotificationDoc)
    } catch (error) {
      console.error('[NotificationService] Lỗi tạo thông báo:', error)
      return null
    }
  },
}
