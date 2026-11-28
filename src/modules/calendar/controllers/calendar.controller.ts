import { randomUUID } from 'node:crypto'
import type { CookieOptions, RequestHandler } from 'express'
import { env } from '@/config/env.js'
import { wakeUpGoogleSyncWorker } from '@/jobs/google-sync-runner.js'
import { AppError } from '@/shared/errors/app-error.js'
import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import { calendarService } from '@/modules/calendar/services/calendar.service.js'
import { googleCalendarOAuthService } from '@/modules/calendar/services/google-calendar-oauth.service.js'
import { googleCalendarSyncService } from '@/modules/calendar/services/google-calendar-sync.service.js'
import { googleSyncRealtimeHub } from '@/modules/calendar/services/google-sync-realtime.hub.js'
import { lunarCalendarService } from '@/modules/calendar/services/lunar-calendar.service.js'
import { vietnameseHolidaysService } from '@/modules/calendar/services/vietnamese-holidays.service.js'
import type { EventQueryFilters } from '@/modules/calendar/types/calendar.types.js'

const GCAL_STATE_COOKIE = 'edutrack_gcal_state'
const GCAL_VERIFIER_COOKIE = 'edutrack_gcal_verifier'
const GCAL_COOKIE_PATH = '/api/v1/calendar/google'

const gcalCookieBase = (): CookieOptions => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
  path: GCAL_COOKIE_PATH,
})

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const paramString = (value: unknown): string => (typeof value === 'string' ? value : '')

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
  const timeZoneOffset: 7 | 8 =
    dates.length > 0 && dates.every((date) => date.timeZoneOffset === 8) ? 8 : 7
  response.json({
    success: true,
    data: {
      dates,
      timeZone: 'Asia/Ho_Chi_Minh',
      timeZoneOffset,
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
    message: 'Đã tạo lịch mới thành công.',
  })
}

export const updateCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const category = await calendarService.updateCategory(userId, paramString(request.params.categoryId), request.body)
  response.json({
    success: true,
    data: { category },
    message: 'Cập nhật lịch thành công.',
  })
}

export const toggleCategoryVisibility: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const isVisible = Boolean(request.body.isVisible)
  const category = await calendarService.toggleCategoryVisibility(
    userId,
    paramString(request.params.categoryId),
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
  const categories = await calendarService.setOnlyCategoryVisible(
    userId,
    paramString(request.params.categoryId),
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
  await calendarService.deleteCategory(userId, paramString(request.params.categoryId))
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
  const categoryId = paramString(request.params.categoryId)
  const { icsContent, filename } = await calendarService.exportCategoryIcs(userId, categoryId)
  response.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  response.send(icsContent)
}

export const importCategory: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const categoryId = paramString(request.params.categoryId)
  const icsContent = typeof request.body?.icsContent === 'string' ? request.body.icsContent : ''
  const result = await calendarService.importCategoryIcs(userId, categoryId, icsContent)
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
  const event = await calendarService.getEventById(userId, paramString(request.params.eventId))
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
  const queryMode = typeof request.query.mode === 'string' ? request.query.mode : undefined
  const queryTargetDate = typeof request.query.targetDate === 'string' ? request.query.targetDate : undefined
  const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>
  const payload = {
    ...body,
    ...(queryMode ? { mode: queryMode } : {}),
    ...(queryTargetDate ? { targetDate: queryTargetDate } : {}),
  }
  const event = await calendarService.updateEvent(userId, paramString(request.params.eventId), payload)
  response.json({
    success: true,
    data: { event },
    message: 'Cập nhật sự kiện thành công.',
  })
}

export const deleteEvent: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const mode = request.query.mode as 'this' | 'following' | 'all' | undefined
  const date = typeof request.query.date === 'string' ? request.query.date : undefined
  const rawScope =
    request.query.googleDeleteScope ??
    (request.body && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>).googleDeleteScope
      : undefined)
  let googleDeleteScope: 'local_only' | 'both' | undefined
  if (rawScope !== undefined) {
    if (rawScope !== 'local_only' && rawScope !== 'both') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Phạm vi xóa Google Lịch không hợp lệ.')
    }
    googleDeleteScope = rawScope
  }

  await calendarService.deleteEvent(
    userId,
    paramString(request.params.eventId),
    mode,
    date,
    googleDeleteScope,
  )
  response.json({
    success: true,
    data: null,
    message: 'Đã xóa sự kiện.',
  })
}

export const toggleTaskComplete: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const isCompleted = Boolean(request.body.isCompleted)
  const rawMode = request.body.mode
  const mode = rawMode === 'this' || rawMode === 'following' || rawMode === 'all' ? rawMode : undefined
  const targetDate = typeof request.body.targetDate === 'string' ? request.body.targetDate : undefined
  const event = await calendarService.toggleTaskComplete(
    userId,
    paramString(request.params.eventId),
    isCompleted,
    mode,
    targetDate,
  )
  response.json({
    success: true,
    data: { event },
    message: isCompleted ? 'Đã đánh dấu hoàn thành!' : 'Đã bỏ đánh dấu hoàn thành.',
  })
}

export const respondEventInvitation: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const status = request.body.status === 'accepted' ? 'accepted' : 'declined'
  const event = await calendarService.respondEventInvitation(
    userId,
    paramString(request.params.eventId),
    status,
  )
  response.json({
    success: true,
    data: { event },
    message: status === 'accepted' ? 'Bạn đã chấp nhận tham gia sự kiện.' : 'Bạn đã từ chối lời mời.',
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
  await calendarService.leaveEvent(userId, paramString(request.params.eventId))
  response.json({
    success: true,
    data: null,
    message: 'Bạn đã rời khỏi sự kiện thành công.',
  })
}

export const startGoogleCalendarConnect: RequestHandler = (request, response) => {
  try {
    const rawMode = request.query.mode === 'reconnect' ? 'reconnect' : 'add'
    const integrationId =
      typeof request.query.integrationId === 'string' ? request.query.integrationId : undefined

    const { authorizationUrl, nonce, codeVerifier } =
      googleCalendarOAuthService.createAuthorizationSession({
        userId: userIdFrom(response.locals),
        mode: rawMode,
        integrationId,
      })

    response.set('Cache-Control', 'no-store')
    response.clearCookie(GCAL_STATE_COOKIE, gcalCookieBase())
    response.clearCookie(GCAL_VERIFIER_COOKIE, gcalCookieBase())
    response.cookie(GCAL_STATE_COOKIE, nonce, { ...gcalCookieBase(), maxAge: 10 * 60 * 1000 })
    response.cookie(GCAL_VERIFIER_COOKIE, codeVerifier, { ...gcalCookieBase(), maxAge: 10 * 60 * 1000 })
    response.redirect(authorizationUrl)
  } catch (error: unknown) {
    const code = error instanceof AppError ? error.code : 'GOOGLE_CALENDAR_CONNECT_FAILED'
    const parameters = new URLSearchParams({ googleSyncError: code })
    response.redirect(`${env.frontendUrl}/calendar?${parameters.toString()}`)
  }
}

export const createGoogleCalendarAuthorization: RequestHandler = (request, response) => {
  const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>
  const mode = body.mode === 'reconnect' ? 'reconnect' : 'add'
  const integrationId = typeof body.integrationId === 'string' ? body.integrationId : undefined

  const { authorizationUrl, nonce, codeVerifier } =
    googleCalendarOAuthService.createAuthorizationSession({
      userId: userIdFrom(response.locals),
      mode,
      integrationId,
    })

  response.set('Cache-Control', 'no-store')
  response.clearCookie(GCAL_STATE_COOKIE, gcalCookieBase())
  response.clearCookie(GCAL_VERIFIER_COOKIE, gcalCookieBase())
  response.cookie(GCAL_STATE_COOKIE, nonce, { ...gcalCookieBase(), maxAge: 10 * 60 * 1000 })
  response.cookie(GCAL_VERIFIER_COOKIE, codeVerifier, { ...gcalCookieBase(), maxAge: 10 * 60 * 1000 })
  response.json({
    success: true,
    data: { authorizationUrl },
  })
}

export const handleGoogleCalendarCallback: RequestHandler = async (request, response) => {
  const storedNonce: unknown = request.cookies[GCAL_STATE_COOKIE]
  const codeVerifier: unknown = request.cookies[GCAL_VERIFIER_COOKIE]
  response.clearCookie(GCAL_STATE_COOKIE, gcalCookieBase())
  response.clearCookie(GCAL_VERIFIER_COOKIE, gcalCookieBase())

  try {
    const { integrationId, isNewConnection } = await googleCalendarOAuthService.completeOAuthCallback({
      errorParam: typeof request.query.error === 'string' ? request.query.error : undefined,
      rawState: typeof request.query.state === 'string' ? request.query.state : '',
      code: typeof request.query.code === 'string' ? request.query.code : undefined,
      storedNonce,
      codeVerifier,
    })

    const parameters = new URLSearchParams({
      googleSyncSuccess: 'ACCOUNT_CONNECTED',
      integrationId,
      isNew: isNewConnection ? '1' : '0',
    })
    response.redirect(`${env.frontendUrl}/calendar?${parameters.toString()}`)
  } catch (error: unknown) {
    const errRecord = error as { code?: unknown; name?: unknown; message?: unknown }
    console.error('[GoogleCalendarOAuth] callback error:', {
      name: typeof errRecord?.name === 'string' ? errRecord.name : 'UnknownError',
      code:
        typeof errRecord?.code === 'string' || typeof errRecord?.code === 'number'
          ? errRecord.code
          : 'UNKNOWN',
      message: typeof errRecord?.message === 'string' ? errRecord.message : 'Unexpected OAuth callback error',
    })
    const errorCode = error instanceof AppError ? error.code : 'GOOGLE_CALENDAR_CONNECT_FAILED'
    const mappedSyncError =
      errorCode === 'GOOGLE_CALENDAR_PERMISSION_DENIED' ||
      errorCode === 'GOOGLE_REFRESH_TOKEN_MISSING' ||
      errorCode === 'GOOGLE_OAUTH_NOT_CONFIGURED' ||
      errorCode === 'GOOGLE_ACCOUNT_MISMATCH' ||
      errorCode === 'GOOGLE_STATE_REPLAYED'
        ? errorCode
        : 'GOOGLE_CALENDAR_CONNECT_FAILED'
    const parameters = new URLSearchParams({ googleSyncError: mappedSyncError })
    response.redirect(`${env.frontendUrl}/calendar?${parameters.toString()}`)
  }
}

export const listGoogleIntegrations: RequestHandler = async (_request, response) => {
  const data = await googleCalendarSyncService.listIntegrations(userIdFrom(response.locals))
  response.json({ success: true, data })
}

export const updateGoogleIntegrationSettings: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.updateIntegrationSettings(
    userIdFrom(response.locals),
    paramString(request.params.integrationId),
    request.body,
  )
  response.json({
    success: true,
    data,
    message: 'Đã cập nhật cài đặt tài khoản Google Lịch.',
  })
}

export const refreshGoogleIntegrationCalendars: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.refreshCalendarsForIntegration(
    userIdFrom(response.locals),
    paramString(request.params.integrationId),
  )
  response.json({
    success: true,
    data,
    message: 'Đã cập nhật danh sách lịch từ Google.',
  })
}

export const updateGoogleCalendarSelection: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.updateCalendarSelection(
    userIdFrom(response.locals),
    paramString(request.params.integrationId),
    request.body,
  )
  wakeUpGoogleSyncWorker()
  response.json({
    success: true,
    data,
    message: 'Đã cập nhật danh sách lịch Google tham gia đồng bộ.',
  })
}

export const syncGoogleIntegration: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.triggerIntegrationSync(
    userIdFrom(response.locals),
    paramString(request.params.integrationId),
  )
  wakeUpGoogleSyncWorker()
  response.json({
    success: true,
    data,
    message: 'Đã đưa yêu cầu đồng bộ vào hàng đợi xử lý.',
  })
}

export const unlinkGoogleIntegration: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.unlinkIntegration(
    userIdFrom(response.locals),
    paramString(request.params.integrationId),
  )
  response.json({
    success: true,
    data,
    message: 'Đã ngắt kết nối tài khoản Google. Các sự kiện đã đồng bộ vẫn được giữ nguyên.',
  })
}

export const updateGoogleCalendarVisibility: RequestHandler = async (request, response) => {
  const isVisible = Boolean((request.body as { isVisible?: unknown } | undefined)?.isVisible)
  const data = await googleCalendarSyncService.updateCalendarVisibility(
    userIdFrom(response.locals),
    paramString(request.params.calendarConnectionId),
    isVisible,
  )
  response.json({
    success: true,
    data,
  })
}

export const syncSingleGoogleCalendar: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.triggerCalendarSync(
    userIdFrom(response.locals),
    paramString(request.params.calendarConnectionId),
  )
  wakeUpGoogleSyncWorker()
  response.json({
    success: true,
    data,
    message: 'Đã đưa yêu cầu đồng bộ lịch Google vào hàng đợi xử lý.',
  })
}

export const retryGoogleSyncJob: RequestHandler = async (request, response) => {
  const data = await googleCalendarSyncService.retryJobManually(
    userIdFrom(response.locals),
    paramString(request.params.jobId),
  )
  wakeUpGoogleSyncWorker()
  response.json({
    success: true,
    data,
    message: 'Đã đưa tác vụ vào hàng đợi thử lại.',
  })
}

export const listGoogleCalendarConflicts: RequestHandler = async (_request, response) => {
  const conflicts = await googleCalendarSyncService.listPendingConflicts(userIdFrom(response.locals))
  response.json({ success: true, data: { conflicts } })
}

export const resolveGoogleCalendarConflict: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>
  const rawChoice = body.choice === 'local' || body.choice === 'google' ? body.choice : undefined
  const rawFieldChoices =
    body.fieldChoices && typeof body.fieldChoices === 'object'
      ? (body.fieldChoices as Record<string, 'local' | 'google'>)
      : undefined

  await googleCalendarSyncService.resolveConflict(userId, paramString(request.params.conflictId), {
    choice: rawChoice,
    fieldChoices: rawFieldChoices,
  })
  wakeUpGoogleSyncWorker()

  const [conflicts, integrationData] = await Promise.all([
    googleCalendarSyncService.listPendingConflicts(userId),
    googleCalendarSyncService.listIntegrations(userId),
  ])
  response.json({
    success: true,
    data: { conflicts, ...integrationData },
    message: 'Đã xử lý xung đột dữ liệu thành công.',
  })
}

export const handleGoogleCalendarWebhook: RequestHandler = async (request, response) => {
  const headerString = (name: string): string => {
    const val = request.headers[name]
    return typeof val === 'string' ? val : ''
  }

  await googleCalendarSyncService.handleWebhookNotification({
    channelId: headerString('x-goog-channel-id'),
    resourceId: headerString('x-goog-resource-id'),
    resourceState: headerString('x-goog-resource-state'),
    channelToken: headerString('x-goog-channel-token'),
  })

  response.status(200).end()
}

export const streamGoogleCalendarSyncEvents: RequestHandler = (request, response) => {
  const userId = userIdFrom(response.locals)
  const subscriberId = randomUUID()

  response.status(200)
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.setHeader('X-Accel-Buffering', 'no')
  response.flushHeaders()
  response.write(`event: connected\ndata: ${JSON.stringify({ subscriberId })}\n\n`)

  const unsubscribe = googleSyncRealtimeHub.subscribe(userId, {
    id: subscriberId,
    send: (eventName, payload) => {
      if (response.writableEnded) return
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`)
    },
  })

  const heartbeatTimer = setInterval(() => {
    if (response.writableEnded) return
    response.write(': keep-alive\n\n')
  }, 25_000)

  void googleCalendarSyncService
    .onUserRealtimeConnected(userId)
    .then(() => {
      wakeUpGoogleSyncWorker()
    })
    .catch(() => undefined)

  request.on('close', () => {
    clearInterval(heartbeatTimer)
    unsubscribe()
  })
}
