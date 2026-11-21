import { Router } from 'express'

import { usersRouter } from '@/modules/account/routes/account.routes.js'
import { authRouter } from '@/modules/auth/routes/auth.routes.js'
import { calendarRouter } from '@/modules/calendar/routes/calendar.routes.js'
import { chatRouter } from '@/modules/chat/routes/chat.routes.js'
import { healthRouter } from '@/modules/health/routes/health.routes.js'
import {
  noteImagesRouter,
  notesRouter,
  noteTagsRouter,
  trashedNotesRouter,
} from '@/modules/notes/routes/notes.routes.js'
import { notificationRouter } from '@/modules/notifications/routes/notification.routes.js'

export const apiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/users', usersRouter)
apiRouter.use('/notes', notesRouter)
apiRouter.use('/note-tags', noteTagsRouter)
apiRouter.use('/note-images', noteImagesRouter)
apiRouter.use('/trash/notes', trashedNotesRouter)
apiRouter.use('/chat', chatRouter)
apiRouter.use('/calendar', calendarRouter)
apiRouter.use('/notifications', notificationRouter)
