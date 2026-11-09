import type { RequestHandler } from 'express'
import { calendarService } from '../services/calendar.service.js'

export const getEvents: RequestHandler = async (_request, response) => {
  const auth = response.locals.auth as { userId: string } | undefined
  const events = await calendarService.getUserEvents(auth?.userId ?? '')
  response.json({
    success: true,
    data: { events },
    message: 'Danh sách sự kiện lịch trình học tập',
  })
}

