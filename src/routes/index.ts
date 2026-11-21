import { Router } from 'express'

import { accountRouter, usersRestRouter } from '@/modules/account/routes/account.routes.js'
import { authRestRouter, authRouter } from '@/modules/auth/routes/auth.routes.js'
import { calendarRestRouter, calendarRouter } from '@/modules/calendar/routes/calendar.routes.js'
import { chatRestRouter, chatRouter } from '@/modules/chat/routes/chat.routes.js'
import { healthRouter } from '@/modules/health/routes/health.routes.js'
import {
  noteImagesRestRouter,
  notesRestRouter,
  notesRouter,
  noteTagsRestRouter,
  trashedNotesRestRouter,
} from '@/modules/notes/routes/notes.routes.js'
import { notificationRestRouter, notificationRouter } from '@/modules/notifications/routes/notification.routes.js'

export const apiRouter = Router()
export const legacyApiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRestRouter)
apiRouter.use('/users', usersRestRouter)
apiRouter.use('/notes', notesRestRouter)
apiRouter.use('/note-tags', noteTagsRestRouter)
apiRouter.use('/note-images', noteImagesRestRouter)
apiRouter.use('/trash/notes', trashedNotesRestRouter)
apiRouter.use('/chat', chatRestRouter)
apiRouter.use('/calendar', calendarRestRouter)
apiRouter.use('/notifications', notificationRestRouter)

legacyApiRouter.use('/health', healthRouter)
legacyApiRouter.use('/auth', authRouter)
legacyApiRouter.use('/account', accountRouter)
legacyApiRouter.use('/calendar', calendarRouter)
legacyApiRouter.use('/notes', notesRouter)
legacyApiRouter.use('/chat', chatRouter)
legacyApiRouter.use('/notifications', notificationRouter)
