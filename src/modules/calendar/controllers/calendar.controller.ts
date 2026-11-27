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

export const leaveCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  await calendarService.leaveCategory(userId, typeof categoryId === 'string' ? categoryId : '')
  response.json({
    success: true,
    data: null,
    message: 'Bạn đã rời khỏi lịch được chia sẻ.',
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

export const resolveGuest: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const identifier = typeof request.body?.identifier === 'string' ? request.body.identifier : ''
  const guest = await calendarService.resolveGuestCandidate(userId, identifier)
  response.json({
    success: true,
    data: guest,
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
  const queryMode = typeof request.query.mode === 'string' ? request.query.mode : undefined
  const queryTargetDate = typeof request.query.targetDate === 'string' ? request.query.targetDate : undefined
  const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>
  const payload = {
    ...body,
    ...(queryMode ? { mode: queryMode } : {}),
    ...(queryTargetDate ? { targetDate: queryTargetDate } : {}),
  }
  const event = await calendarService.updateEvent(userId, typeof eventId === 'string' ? eventId : '', payload)
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
  const rawMode = request.body.mode
  const mode = rawMode === 'this' || rawMode === 'following' || rawMode === 'all' ? rawMode : undefined
  const targetDate = typeof request.body.targetDate === 'string' ? request.body.targetDate : undefined
  const event = await calendarService.toggleTaskComplete(
    userId,
    typeof eventId === 'string' ? eventId : '',
    isCompleted,
    mode,
    targetDate,
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

export const enableEventShare: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  const regenerate = Boolean(request.body?.regenerate)
  const share = await calendarService.enableEventShare(
    userId,
    typeof eventId === 'string' ? eventId : '',
    regenerate,
  )
  response.json({
    success: true,
    data: share,
    message: 'Đã tạo liên kết chia sẻ sự kiện.',
  })
}

export const revokeEventShare: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId } = request.params
  await calendarService.revokeEventShare(userId, typeof eventId === 'string' ? eventId : '')
  response.json({
    success: true,
    data: null,
    message: 'Đã thu hồi liên kết chia sẻ sự kiện.',
  })
}

export const getSharedEventByToken: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { shareToken } = request.params
  const event = await calendarService.getSharedEventByToken(
    userId,
    typeof shareToken === 'string' ? shareToken : '',
  )
  response.json({
    success: true,
    data: { event },
  })
}

export const requestJoinSharedEvent: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { shareToken } = request.params
  const message = typeof request.body?.message === 'string' ? request.body.message : ''
  const result = await calendarService.requestJoinSharedEvent(
    userId,
    typeof shareToken === 'string' ? shareToken : '',
    message,
  )
  response.status(201).json({
    success: true,
    data: result,
    message: 'Đã gửi yêu cầu xin tham gia sự kiện.',
  })
}

export const cancelJoinRequest: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { shareToken } = request.params
  await calendarService.cancelJoinRequest(
    userId,
    typeof shareToken === 'string' ? shareToken : '',
  )
  response.json({
    success: true,
    data: null,
    message: 'Đã hủy yêu cầu tham gia sự kiện.',
  })
}

export const respondJoinRequest: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { eventId, requestId } = request.params
  const decision = request.body?.decision === 'rejected' ? 'rejected' : 'approved'
  const event = await calendarService.respondJoinRequest(
    userId,
    typeof eventId === 'string' ? eventId : '',
    typeof requestId === 'string' ? requestId : '',
    decision,
  )
  response.json({
    success: true,
    data: { event },
    message: decision === 'approved' ? 'Đã đồng ý yêu cầu tham gia.' : 'Đã từ chối yêu cầu tham gia.',
  })
}

export const regeneratePublicToken: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  const result = await calendarService.regeneratePublicToken(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
  )
  response.json({
    success: true,
    data: result,
    message: 'Đã tạo liên kết công khai mới.',
  })
}

export const getPublicCalendar: RequestHandler = async (request, response) => {
  const { publicToken } = request.params
  const data = await calendarService.getPublicCalendarByToken(
    typeof publicToken === 'string' ? publicToken : '',
  )
  response.json({
    success: true,
    data,
  })
}

export const exportPublicCalendarIcs: RequestHandler = async (request, response) => {
  const { publicToken } = request.params
  const { icsContent, filename } = await calendarService.exportPublicCalendarIcs(
    typeof publicToken === 'string' ? publicToken : '',
  )
  response.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  response.send(icsContent)
}

export const subscribePublicCalendar: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { publicToken } = request.params
  await calendarService.subscribePublicCalendar(
    userId,
    typeof publicToken === 'string' ? publicToken : '',
  )
  response.status(201).json({
    success: true,
    data: null,
    message: 'Đã theo dõi lịch công khai.',
  })
}

export const unsubscribePublicCalendar: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const { categoryId } = request.params
  await calendarService.unsubscribePublicCalendar(
    userId,
    typeof categoryId === 'string' ? categoryId : '',
  )
  response.json({
    success: true,
    data: null,
    message: 'Đã bỏ theo dõi lịch công khai.',
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
