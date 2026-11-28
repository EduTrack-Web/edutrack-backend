import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  createCategory,
  createEvent,
  createGoogleCalendarAuthorization,
  deleteCategory,
  deleteEvent,
  exportCategory,
  getCalendarPreferences,
  getCategories,
  getEventById,
  getEvents,
  getVietnameseHolidays,
  getVietnameseLunarDates,
  handleGoogleCalendarCallback,
  handleGoogleCalendarWebhook,
  importCategory,
  leaveEvent,
  listGoogleCalendarConflicts,
  listGoogleIntegrations,
  refreshGoogleIntegrationCalendars,
  resolveGoogleCalendarConflict,
  respondEventInvitation,
  retryGoogleSyncJob,
  leaveCategory,
  resolveGuest,
  setAllCategoriesVisibility,
  setOnlyCategoryVisible,
  startGoogleCalendarConnect,
  streamGoogleCalendarSyncEvents,
  syncGoogleIntegration,
  syncSingleGoogleCalendar,
  toggleCategoryVisibility,
  toggleTaskComplete,
  unlinkGoogleIntegration,
  updateCalendarPreferences,
  updateCategory,
  updateEvent,
  updateGoogleCalendarSelection,
  updateGoogleCalendarVisibility,
  updateGoogleIntegrationSettings,
  enableEventShare,
  revokeEventShare,
  getSharedEventByToken,
  requestJoinSharedEvent,
  cancelJoinRequest,
  respondJoinRequest,
  regeneratePublicToken,
  getPublicCalendar,
  exportPublicCalendarIcs,
  subscribePublicCalendar,
  unsubscribePublicCalendar,
} from '@/modules/calendar/controllers/calendar.controller.js'

export const calendarRouter = Router()

const lunarCalendarLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      success: false,
      code: 'LUNAR_CALENDAR_RATE_LIMITED',
      message: 'Bạn đang tải lịch Âm quá nhanh. Vui lòng thử lại sau.',
    })
  },
})

calendarRouter.get('/public/:publicToken', getPublicCalendar)
calendarRouter.get('/public/:publicToken/export-file', exportPublicCalendarIcs)
const holidaysLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      success: false,
      code: 'HOLIDAYS_RATE_LIMITED',
      message: 'Bạn đang tải dữ liệu ngày lễ quá nhanh. Vui lòng thử lại sau.',
    })
  },
})

const googleSyncLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      success: false,
      code: 'GOOGLE_CALENDAR_RATE_LIMITED',
      message: 'Bạn đang thao tác đồng bộ Google Lịch quá nhanh. Vui lòng thử lại sau ít phút.',
    })
  },
})

const googleWebhookLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

calendarRouter.get('/google/callback', handleGoogleCalendarCallback)
calendarRouter.post('/google/webhook', googleWebhookLimiter, handleGoogleCalendarWebhook)
calendarRouter.use(authenticate)
calendarRouter.get('/preferences', getCalendarPreferences)
calendarRouter.put('/preferences', requireCsrf, updateCalendarPreferences)

calendarRouter.get('/google/stream', streamGoogleCalendarSyncEvents)
calendarRouter.get('/google/authorizations', startGoogleCalendarConnect)
calendarRouter.post('/google/authorizations', requireCsrf, createGoogleCalendarAuthorization)
calendarRouter.get('/google/integrations', listGoogleIntegrations)
calendarRouter.patch('/google/integrations/:integrationId/settings', requireCsrf, updateGoogleIntegrationSettings)
calendarRouter.post(
  '/google/integrations/:integrationId/calendars/refresh',
  requireCsrf,
  googleSyncLimiter,
  refreshGoogleIntegrationCalendars,
)
calendarRouter.put(
  '/google/integrations/:integrationId/calendars/selection',
  requireCsrf,
  updateGoogleCalendarSelection,
)
calendarRouter.post('/google/integrations/:integrationId/sync', requireCsrf, googleSyncLimiter, syncGoogleIntegration)
calendarRouter.delete('/google/integrations/:integrationId', requireCsrf, unlinkGoogleIntegration)
calendarRouter.patch('/google/calendars/:calendarConnectionId/visibility', requireCsrf, updateGoogleCalendarVisibility)
calendarRouter.post('/google/calendars/:calendarConnectionId/sync', requireCsrf, googleSyncLimiter, syncSingleGoogleCalendar)
calendarRouter.post('/google/jobs/:jobId/retry', requireCsrf, googleSyncLimiter, retryGoogleSyncJob)
calendarRouter.get('/google/conflicts', listGoogleCalendarConflicts)
calendarRouter.post('/google/conflicts/:conflictId/resolution', requireCsrf, resolveGoogleCalendarConflict)

calendarRouter.get('/lunar-dates', lunarCalendarLimiter, getVietnameseLunarDates)
calendarRouter.get('/holidays', holidaysLimiter, getVietnameseHolidays)
calendarRouter.get('/categories', getCategories)
calendarRouter.post('/categories', requireCsrf, createCategory)
calendarRouter.put('/category-visibility', requireCsrf, setAllCategoriesVisibility)
calendarRouter.put('/categories/:categoryId/visibility-selection', requireCsrf, setOnlyCategoryVisible)
calendarRouter.put('/categories/:categoryId', requireCsrf, updateCategory)
calendarRouter.patch('/categories/:categoryId/visibility', requireCsrf, toggleCategoryVisibility)
calendarRouter.delete('/categories/:categoryId', requireCsrf, deleteCategory)
calendarRouter.delete('/categories/:categoryId/members/me', requireCsrf, leaveCategory)
calendarRouter.post('/categories/:categoryId/public-token', requireCsrf, regeneratePublicToken)
calendarRouter.post('/public/:publicToken/subscribe', requireCsrf, subscribePublicCalendar)
calendarRouter.delete('/categories/:categoryId/subscription', requireCsrf, unsubscribePublicCalendar)
calendarRouter.get('/categories/:categoryId/export-file', exportCategory)
calendarRouter.post('/categories/:categoryId/imports', requireCsrf, importCategory)

calendarRouter.post('/guests/resolve', requireCsrf, resolveGuest)
calendarRouter.get('/events', getEvents)
calendarRouter.post('/events', requireCsrf, createEvent)
calendarRouter.get('/events/:eventId', getEventById)
calendarRouter.put('/events/:eventId', requireCsrf, updateEvent)
calendarRouter.delete('/events/:eventId', requireCsrf, deleteEvent)
calendarRouter.patch('/events/:eventId/completion', requireCsrf, toggleTaskComplete)
calendarRouter.patch('/events/:eventId/invitations/me', requireCsrf, respondEventInvitation)
calendarRouter.delete('/events/:eventId/attendees/me', requireCsrf, leaveEvent)
calendarRouter.post('/events/:eventId/share', requireCsrf, enableEventShare)
calendarRouter.delete('/events/:eventId/share', requireCsrf, revokeEventShare)
calendarRouter.patch('/events/:eventId/join-requests/:requestId', requireCsrf, respondJoinRequest)
calendarRouter.get('/shared/:shareToken', getSharedEventByToken)
calendarRouter.post('/shared/:shareToken/join-requests', requireCsrf, requestJoinSharedEvent)
calendarRouter.delete('/shared/:shareToken/join-requests/me', requireCsrf, cancelJoinRequest)
