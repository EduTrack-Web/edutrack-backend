import type { RequestHandler } from 'express'
import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import { calendarService } from '@/modules/calendar/services/calendar.service.js'
import { lunarCalendarService } from '@/modules/calendar/services/lunar-calendar.service.js'
import { vietnameseHolidaysService } from '@/modules/calendar/services/vietnamese-holidays.service.js'
import type { EventQueryFilters } from '@/modules/calendar/types/calendar.types.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

export const getCalendarPreferences: RequestHandler = async (_request, response) => {
  const preferences = await lunarCalendarService.getPreferences(userIdFrom(response.locals))
  response.json({ success: true, data: { preferences } })
}

export const updateCalendarPreferences: RequestHandler = async (request, response) => {
  const preferences = await lunarCalendarService.updatePreferences(
    userIdFrom(response.locals),
    request.body,
  )
  response.json({
    success: true,
    data: { preferences },
    message: 'Đã cập nhật cài đặt hiển thị lịch.',
  })
}

export const getVietnameseLunarDates: RequestHandler = async (request, response) => {
  const dates = lunarCalendarService.getDates(request.query.from, request.query.to)
  response.json({
    success: true,
    data: {
      dates,
      timeZone: 'Asia/Ho_Chi_Minh',
      timeZoneOffset: 7,
    },
  })
}

export const getVietnameseHolidays: RequestHandler = async (request, response) => {
  const holidays = await vietnameseHolidaysService.getHolidays(request.query.from, request.query.to)
  response.json({
    success: true,
    data: { holidays },
  })
}

export const getCategories: RequestHandler = async (_request, response) => {
  const userId = userIdFrom(response.locals)
  const categories = await calendarService.getCategories(userId)
  response.json({
    success: true,
    data: { categories },
  })
}

export const createCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const category = await calendarService.createCategory(userId, request.body)
  response.status(201).json({
    success: true,
    data: { category },
    message: 'Tạo lịch mới thành công.',
  })
}

export const updateCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  const category = await calendarService.updateCategory(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
    request.body,
  )
  response.json({
    success: true,
    data: { category },
    message: 'Cập nhật lịch thành công.',
  })
}

export const toggleCategoryVisibility: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  const isVisible = Boolean(request.body.isVisible)
  const category = await calendarService.toggleCategoryVisibility(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
    isVisible,
  )
  response.json({
    success: true,
    data: { category },
    message: isVisible ? 'Đã bật hiển thị lịch.' : 'Đã ẩn lịch.',
  })
}

export const setOnlyCategoryVisible: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  const categories = await calendarService.setOnlyCategoryVisible(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
  )
  response.json({
    success: true,
    data: { categories },
    message: 'Đã cập nhật chỉ hiển thị lịch này.',
  })
}

export const setAllCategoriesVisibility: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const isVisible = typeof request.body?.isVisible === 'boolean' ? request.body.isVisible : true
  const categories = await calendarService.setAllCategoriesVisibility(userId, isVisible)
  response.json({
    success: true,
    data: { categories },
    message: isVisible ? 'Đã hiển thị tất cả các lịch.' : 'Đã ẩn tất cả các lịch.',
  })
}

export const deleteCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  await calendarService.deleteCategory(userId, typeof categoryId === 'string' ? categoryId : '')
  response.json({
    success: true,
    data: null,
    message: 'Đã xóa lịch.',
  })
}

export const exportCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  const { icsContent, filename } = await calendarService.exportCategoryIcs(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
  )
  response.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  response.send(icsContent)
}

export const importCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  const icsContent = typeof request.body?.icsContent === 'string' ? request.body.icsContent : ''
  const result = await calendarService.importCategoryIcs(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
    icsContent,
  )
  response.status(201).json({
    success: true,
    data: result,
    message: `Đã nhập thành công ${result.importedCount} sự kiện vào lịch.`,
  })
}

export const getEvents: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)

  let calendarIds: string[] | undefined
  if (typeof request.query.calendarIds === 'string' && request.query.calendarIds.trim()) {
    calendarIds = request.query.calendarIds.split(',').map((id) => id.trim()).filter(Boolean)
  }

  const filters: EventQueryFilters = {
    from: typeof request.query.from === 'string' ? request.query.from : undefined,
    to: typeof request.query.to === 'string' ? request.query.to : undefined,
    entryType:
      request.query.entryType === 'event' || request.query.entryType === 'task'
        ? request.query.entryType
        : undefined,
    calendarId: typeof request.query.calendarId === 'string' ? request.query.calendarId : undefined,
    calendarIds,
    isCompleted:
      request.query.isCompleted === 'true'
        ? true
        : request.query.isCompleted === 'false'
          ? false
          : undefined,
    q: typeof request.query.q === 'string' ? request.query.q : undefined,
  }

  const events = await calendarService.getEvents(userId, filters)
  response.json({
    success: true,
    data: { events },
    message: 'Danh sách sự kiện lịch trình',
  })
}

export const getEventById: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  const event = await calendarService.getEventById(userId, typeof eventId === 'string' ? eventId : '')
  response.json({
    success: true,
    data: { event },
  })
}

export const createEvent: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const event = await calendarService.createEvent(userId, request.body)
  response.status(201).json({
    success: true,
    data: { event },
    message: 'Đã tạo sự kiện mới thành công.',
  })
}

export const updateEvent: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  const event = await calendarService.updateEvent(userId, typeof eventId === 'string' ? eventId : '', request.body)
  response.json({
    success: true,
    data: { event },
    message: 'Cập nhật sự kiện thành công.',
  })
}

export const deleteEvent: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  const mode = request.query.mode as 'this' | 'following' | 'all' | undefined
  const date = typeof request.query.date === 'string' ? request.query.date : undefined
  await calendarService.deleteEvent(userId, typeof eventId === 'string' ? eventId : '', mode, date)
  response.json({
    success: true,
    data: null,
    message: 'Đã xóa sự kiện.',
  })
}

export const toggleTaskComplete: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  const isCompleted = Boolean(request.body.isCompleted)
  const event = await calendarService.toggleTaskComplete(
    userId,
    typeof eventId === 'string' ? eventId : '',
    isCompleted,
  )
  response.json({
    success: true,
    data: { event },
    message: isCompleted ? 'Đã đánh dấu hoàn thành nhiệm vụ.' : 'Đã mở lại nhiệm vụ.',
  })
}

export const respondEventInvitation: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  const status = request.body.status === 'declined' ? 'declined' : 'accepted'
  const event = await calendarService.respondEventInvitation(
    userId,
    typeof eventId === 'string' ? eventId : '',
    status,
  )
  response.json({
    success: true,
    data: { event },
    message: status === 'accepted' ? 'Đã chấp nhận lời mời tham gia sự kiện.' : 'Đã từ chối lời mời tham gia sự kiện.',
  })
}

export const leaveEvent: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  await calendarService.leaveEvent(userId, typeof eventId === 'string' ? eventId : '')
  response.json({
    success: true,
    data: null,
    message: 'Bạn đã rời khỏi sự kiện thành công.',
  })
}
