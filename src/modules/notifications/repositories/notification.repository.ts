import { Types } from 'mongoose'
import { NotificationModel } from '../models/notification.model.js'
import type { CreateNotificationInput } from '../types/notification.types.js'

const isValidObjectId = (id: string): boolean => Types.ObjectId.isValid(id)

export const notificationRepository = {
  findByUserId: (userId: string, limit = 50) => {
    const userObjectId = isValidObjectId(userId) ? new Types.ObjectId(userId) : userId
    return NotificationModel.find({ $or: [{ userId: userObjectId }, { userId }] })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
  },

  countUnreadByUserId: (userId: string) => {
    const userObjectId = isValidObjectId(userId) ? new Types.ObjectId(userId) : userId
    return NotificationModel.countDocuments({
      $or: [{ userId: userObjectId }, { userId }],
      isRead: false,
    })
  },

  markAsRead: (userId: string, notificationId: string) => {
    if (!isValidObjectId(notificationId)) return null
    const userObjectId = isValidObjectId(userId) ? new Types.ObjectId(userId) : userId
    return NotificationModel.findOneAndUpdate(
      { _id: notificationId, $or: [{ userId: userObjectId }, { userId }] },
      { $set: { isRead: true } },
      { returnDocument: 'after' },
    ).lean()
  },

  markAllAsRead: (userId: string) => {
    const userObjectId = isValidObjectId(userId) ? new Types.ObjectId(userId) : userId
    return NotificationModel.updateMany(
      { $or: [{ userId: userObjectId }, { userId }], isRead: false },
      { $set: { isRead: true } },
    )
  },

  deleteNotification: (userId: string, notificationId: string) => {
    if (!isValidObjectId(notificationId)) return null
    const userObjectId = isValidObjectId(userId) ? new Types.ObjectId(userId) : userId
    return NotificationModel.findOneAndDelete({
      _id: notificationId,
      $or: [{ userId: userObjectId }, { userId }],
    }).lean()
  },

  create: (data: CreateNotificationInput) => {
    let rawUserId: unknown = data.userId
    if (rawUserId && typeof rawUserId === 'object' && '_id' in (rawUserId as Record<string, unknown>)) {
      rawUserId = (rawUserId as { _id: unknown })._id
    }
    const cleanUserId = String(rawUserId ?? '')
    const userObjectId = isValidObjectId(cleanUserId) ? new Types.ObjectId(cleanUserId) : cleanUserId
    return NotificationModel.create({
      userId: userObjectId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link ?? '',
      eventId: data.eventId && isValidObjectId(data.eventId) ? new Types.ObjectId(data.eventId) : null,
      metadata: data.metadata ?? {},
      isRead: false,
    })
  },
}
