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
calendarRouter.patch('/categories/visibility/all', requireCsrf, setAllCategoriesVisibility)
calendarRouter.patch('/categories/:categoryId/only', requireCsrf, setOnlyCategoryVisible)
calendarRouter.put('/categories/:categoryId', requireCsrf, updateCategory)
calendarRouter.patch('/categories/:categoryId/visibility', requireCsrf, toggleCategoryVisibility)
calendarRouter.delete('/categories/:categoryId', requireCsrf, deleteCategory)
calendarRouter.get('/categories/:categoryId/export', exportCategory)
calendarRouter.post('/categories/:categoryId/import', requireCsrf, importCategory)

calendarRouter.get('/events', getEvents)
calendarRouter.post('/events', requireCsrf, createEvent)
calendarRouter.get('/events/:eventId', getEventById)
calendarRouter.put('/events/:eventId', requireCsrf, updateEvent)
calendarRouter.delete('/events/:eventId', requireCsrf, deleteEvent)
calendarRouter.patch('/events/:eventId/toggle-complete', requireCsrf, toggleTaskComplete)
calendarRouter.post('/events/:eventId/respond-invite', requireCsrf, respondEventInvitation)
calendarRouter.post('/events/:eventId/leave', requireCsrf, leaveEvent)
