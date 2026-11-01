import { Router } from 'express'

import { healthRouter } from '../modules/health/health.routes.js'
import { authRouter } from '../modules/auth/auth.routes.js'
import { calendarRouter } from '../modules/calendar/calendar.routes.js'
import { notesRouter } from '../modules/notes/notes.routes.js'
import { chatRouter } from '../modules/chat/chat.routes.js'

export const apiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/calendar', calendarRouter)
apiRouter.use('/notes', notesRouter)
apiRouter.use('/chat', chatRouter)
