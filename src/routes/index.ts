import { Router } from 'express'

import { authRouter } from '../modules/auth/routes/auth.routes.js'
import { calendarRouter } from '../modules/calendar/routes/calendar.routes.js'
import { chatRouter } from '../modules/chat/routes/chat.routes.js'
import { healthRouter } from '../modules/health/routes/health.routes.js'
import { notesRouter } from '../modules/notes/routes/notes.routes.js'

export const apiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/calendar', calendarRouter)
apiRouter.use('/notes', notesRouter)
apiRouter.use('/chat', chatRouter)
