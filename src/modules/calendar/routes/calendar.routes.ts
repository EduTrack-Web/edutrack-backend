import { Router } from 'express'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { getEvents } from '@/modules/calendar/controllers/calendar.controller.js'

export const calendarRouter = Router()

calendarRouter.use(authenticate)
calendarRouter.get('/events', getEvents)

