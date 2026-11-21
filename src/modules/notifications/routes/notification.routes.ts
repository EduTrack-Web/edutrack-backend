import { Router } from 'express'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  deleteNotification,
  getNotifications,
  markAllAsRead,
  markAsRead,
  updateNotification,
  updateNotifications,
} from '../controllers/notification.controller.js'

export const notificationRouter = Router()
export const notificationRestRouter = Router()

notificationRouter.use(authenticate)

notificationRouter.get('/', getNotifications)
notificationRouter.patch('/read-all', requireCsrf, markAllAsRead)
notificationRouter.patch('/:notificationId/read', requireCsrf, markAsRead)
notificationRouter.delete('/:notificationId', requireCsrf, deleteNotification)

notificationRestRouter.use(authenticate)
notificationRestRouter.get('/', getNotifications)
notificationRestRouter.patch('/', requireCsrf, updateNotifications)
notificationRestRouter.patch('/:notificationId', requireCsrf, updateNotification)
notificationRestRouter.delete('/:notificationId', requireCsrf, deleteNotification)
