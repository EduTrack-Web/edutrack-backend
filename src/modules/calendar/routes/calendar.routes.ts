import { Router } from 'express'
import { authenticate } from '../../../shared/middleware/authenticate.js'
import { requireCsrf } from '../../../shared/middleware/csrf.js'
import {
  createCategory,
  createEvent,
  deleteCategory,
  deleteEvent,
  getCategories,
  getEventById,
  getEvents,
  setAllCategoriesVisibility,
  setOnlyCategoryVisible,
  toggleCategoryVisibility,
  toggleTaskComplete,
  updateCategory,
  updateEvent,
} from '../controllers/calendar.controller.js'

export const calendarRouter = Router()

calendarRouter.use(authenticate)

// Quản lý Lịch của tôi (Calendar Categories)
calendarRouter.get('/categories', getCategories)
calendarRouter.post('/categories', requireCsrf, createCategory)
calendarRouter.patch('/categories/visibility/all', requireCsrf, setAllCategoriesVisibility)
calendarRouter.patch('/categories/:categoryId/only', requireCsrf, setOnlyCategoryVisible)
calendarRouter.put('/categories/:categoryId', requireCsrf, updateCategory)
calendarRouter.patch('/categories/:categoryId/visibility', requireCsrf, toggleCategoryVisibility)
calendarRouter.delete('/categories/:categoryId', requireCsrf, deleteCategory)

// Quản lý Sự kiện & Nhiệm vụ (Events & Tasks)
calendarRouter.get('/events', getEvents)
calendarRouter.post('/events', requireCsrf, createEvent)
calendarRouter.get('/events/:eventId', getEventById)
calendarRouter.put('/events/:eventId', requireCsrf, updateEvent)
calendarRouter.delete('/events/:eventId', requireCsrf, deleteEvent)
calendarRouter.patch('/events/:eventId/toggle-complete', requireCsrf, toggleTaskComplete)
