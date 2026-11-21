import { Router } from 'express'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  createCategory,
  createEvent,
  deleteCategory,
  deleteEvent,
  exportCategory,
  getCategories,
  getEventById,
  getEvents,
  importCategory,
  setAllCategoriesVisibility,
  setOnlyCategoryVisible,
  toggleCategoryVisibility,
  toggleTaskComplete,
  updateCategory,
  updateEvent,
  respondEventInvitation,
  leaveEvent,
} from '@/modules/calendar/controllers/calendar.controller.js'
export const calendarRouter = Router()

calendarRouter.use(authenticate)
calendarRouter.get('/categories', getCategories)
calendarRouter.post('/categories', requireCsrf, createCategory)
calendarRouter.put('/category-visibility', requireCsrf, setAllCategoriesVisibility)
calendarRouter.put('/categories/:categoryId/visibility-selection', requireCsrf, setOnlyCategoryVisible)
calendarRouter.put('/categories/:categoryId', requireCsrf, updateCategory)
calendarRouter.patch('/categories/:categoryId/visibility', requireCsrf, toggleCategoryVisibility)
calendarRouter.delete('/categories/:categoryId', requireCsrf, deleteCategory)
calendarRouter.get('/categories/:categoryId/export-file', exportCategory)
calendarRouter.post('/categories/:categoryId/imports', requireCsrf, importCategory)

calendarRouter.get('/events', getEvents)
calendarRouter.post('/events', requireCsrf, createEvent)
calendarRouter.get('/events/:eventId', getEventById)
calendarRouter.put('/events/:eventId', requireCsrf, updateEvent)
calendarRouter.delete('/events/:eventId', requireCsrf, deleteEvent)
calendarRouter.patch('/events/:eventId/completion', requireCsrf, toggleTaskComplete)
calendarRouter.patch('/events/:eventId/invitations/me', requireCsrf, respondEventInvitation)
calendarRouter.delete('/events/:eventId/attendees/me', requireCsrf, leaveEvent)
