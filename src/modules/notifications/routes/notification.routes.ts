import { Router } from 'express'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  deleteNotification,
  getNotifications,
  markAllAsRead,
  markAsRead,
} from '../controllers/notification.controller.js'

export const notificationRouter = Router()

notificationRouter.use(authenticate)

notificationRouter.get('/', getNotifications)
notificationRouter.patch('/read-all', requireCsrf, markAllAsRead)
notificationRouter.patch('/:notificationId/read', requireCsrf, markAsRead)
notificationRouter.delete('/:notificationId', requireCsrf, deleteNotification)
