import { Router } from 'express'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  deleteNotification,
  getNotifications,
  updateNotification,
  updateNotifications,
} from '../controllers/notification.controller.js'

export const notificationRouter = Router()

notificationRouter.use(authenticate)
notificationRouter.get('/', getNotifications)
notificationRouter.patch('/', requireCsrf, updateNotifications)
notificationRouter.patch('/:notificationId', requireCsrf, updateNotification)
notificationRouter.delete('/:notificationId', requireCsrf, deleteNotification)
