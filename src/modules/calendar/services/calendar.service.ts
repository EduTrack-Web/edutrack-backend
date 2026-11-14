import { AppError } from '../../../shared/errors/app-error.js'
import { CalendarCategoryModel } from '../models/calendar-category.model.js'
import { EventModel } from '../models/event.model.js'
import { calendarRepository } from '../repositories/calendar.repository.js'
import type {
  CalendarCategoryResponse,
  CalendarEventResponse,
  EventQueryFilters,
  RecurrenceConfig,
  ReminderItem,
  SubtaskItem,
} from '../types/calendar.types.js'
import {
  validateCreateCategory,
  validateCreateEvent,
  validateUpdateCategory,
  validateUpdateEvent,
} from '../validations/calendar.validation.js'

interface RawCategoryDoc {
  _id: unknown
  userId: unknown
  name: string
  color: string
  description?: string
  isVisible?: boolean
  isDefault?: boolean
  createdAt?: Date
  updatedAt?: Date
}

interface RawPopulatedCategory {
  _id: unknown
  name: string
  color: string
  description?: string
  isVisible?: boolean
}

interface RawEventDoc {
  _id: unknown
  userId: unknown
  calendarId?: unknown
  entryType: 'event' | 'task'
  title: string
  description?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  startDate: Date
  endDate: Date
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: 'busy' | 'free'
  visibility?: 'default' | 'public' | 'private'
  isCompleted?: boolean
  completedAt?: Date | null
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: {
    frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: number
    daysOfWeek?: number[]
    until?: Date | null
  }
  createdAt?: Date
  updatedAt?: Date
}

const mapCategoryResponse = (doc: RawCategoryDoc): CalendarCategoryResponse => ({
  id: String(doc._id),
  userId: String(doc.userId),
  name: doc.name,
  color: doc.color,
  description: doc.description ?? '',
  isVisible: doc.isVisible ?? true,
  isDefault: Boolean(doc.isDefault),
  createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
  updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
})

const mapEventResponse = (doc: RawEventDoc): CalendarEventResponse => {
  let calendarInfo: CalendarCategoryResponse | null = null
  let rawCalendarId: string | null = null

  if (doc.calendarId && typeof doc.calendarId === 'object' && '_id' in doc.calendarId) {
    const pop = doc.calendarId as RawPopulatedCategory
    rawCalendarId = String(pop._id)
    calendarInfo = {
      id: String(pop._id),
      userId: String(doc.userId),
      name: pop.name,
      color: pop.color,
      description: pop.description ?? '',
      isVisible: pop.isVisible ?? true,
      isDefault: false,
      createdAt: '',
      updatedAt: '',
    }
  } else if (doc.calendarId) {
    rawCalendarId = String(doc.calendarId)
  }

  let formattedRecurrence: RecurrenceConfig | undefined
  if (doc.recurrence && doc.recurrence.frequency !== 'none') {
    formattedRecurrence = {
      frequency: doc.recurrence.frequency,
      interval: doc.recurrence.interval,
      daysOfWeek: doc.recurrence.daysOfWeek,
      until: doc.recurrence.until ? doc.recurrence.until.toISOString() : null,
    }
  }

  return {
    id: String(doc._id),
    userId: String(doc.userId),
    calendarId: rawCalendarId,
    calendar: calendarInfo,
    entryType: doc.entryType,
    title: doc.title,
    description: doc.description ?? '',
    priority: doc.priority,
    startDate: doc.startDate.toISOString(),
    endDate: doc.endDate.toISOString(),
    isAllDay: Boolean(doc.isAllDay),
    location: doc.location ?? '',
    onlineMeetingUrl: doc.onlineMeetingUrl ?? '',
    submissionUrl: doc.submissionUrl ?? '',
    color: doc.color || (calendarInfo ? calendarInfo.color : '#2563EB'),
    availability: doc.availability ?? 'busy',
    visibility: doc.visibility ?? 'default',
    isCompleted: Boolean(doc.isCompleted),
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    checklist: Array.isArray(doc.checklist) ? doc.checklist : [],
    reminders: Array.isArray(doc.reminders) ? doc.reminders : [{ method: 'in-app', minutesBefore: 15 }],
    recurrence: formattedRecurrence,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
  }
}

export const calendarService = {
  // CATEGORY SERVICES (LỊCH CỦA TÔI)
  getCategories: async (userId: string): Promise<CalendarCategoryResponse[]> => {
    // Tự động dọn dẹp các lịch seed cũ ("Học chính khoá", "Try hard", "Bài tập") nếu user chưa gắn sự kiện
    await CalendarCategoryModel.deleteMany({
      userId,
      isDefault: true,
      name: { $in: ['🎓 Học chính khoá', 'Học chính khoá', '📝 Bài tập & Hạn chót', '💡 Tự học - Try hard', '🌟 Cá nhân & Hoạt động', 'Học tập'] },
    })

    const categories = await calendarRepository.findCategoriesByUserId(userId)
    return categories.map((cat) => mapCategoryResponse(cat as unknown as RawCategoryDoc))
  },

  createCategory: async (userId: string, payload: unknown): Promise<CalendarCategoryResponse> => {
    const data = validateCreateCategory(payload)

    const existing = await calendarRepository.findCategoryByName(userId, data.name)
    if (existing) {
      throw new AppError(409, 'CATEGORY_EXISTS', 'Lịch này đã tồn tại trong danh sách của bạn', {
        name: 'Tên lịch đã tồn tại',
      })
    }

    const created = await calendarRepository.createCategory(userId, data)
    return mapCategoryResponse(created as unknown as RawCategoryDoc)
  },

  updateCategory: async (userId: string, categoryId: string, payload: unknown): Promise<CalendarCategoryResponse> => {
    const data = validateUpdateCategory(payload)

    const existing = await calendarRepository.findCategoryById(userId, categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await calendarRepository.findCategoryByName(userId, data.name)
      if (duplicate && String(duplicate._id) !== categoryId) {
        throw new AppError(409, 'CATEGORY_EXISTS', 'Tên lịch đã tồn tại', {
          name: 'Tên lịch đã tồn tại',
        })
      }
    }

    const updated = await calendarRepository.updateCategory(userId, categoryId, data)
    if (!updated) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    return mapCategoryResponse(updated as unknown as RawCategoryDoc)
  },

  toggleCategoryVisibility: async (
    userId: string,
    categoryId: string,
    isVisible: boolean,
  ): Promise<CalendarCategoryResponse> => {
    const existing = await calendarRepository.findCategoryById(userId, categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const updated = await calendarRepository.setCategoryVisibility(userId, categoryId, isVisible)
    if (!updated) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    return mapCategoryResponse(updated as unknown as RawCategoryDoc)
  },

  setOnlyCategoryVisible: async (
    userId: string,
    categoryId: string,
  ): Promise<CalendarCategoryResponse[]> => {
    const existing = await calendarRepository.findCategoryById(userId, categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    await calendarRepository.setOnlyCategoryVisible(userId, categoryId)
    const all = await calendarRepository.findCategoriesByUserId(userId)
    return all.map((cat) => mapCategoryResponse(cat as unknown as RawCategoryDoc))
  },

  setAllCategoriesVisibility: async (
    userId: string,
    isVisible: boolean,
  ): Promise<CalendarCategoryResponse[]> => {
    const all = await calendarRepository.setAllCategoriesVisibility(userId, isVisible)
    return all.map((cat) => mapCategoryResponse(cat as unknown as RawCategoryDoc))
  },

  deleteCategory: async (userId: string, categoryId: string): Promise<void> => {
    const existing = await calendarRepository.findCategoryById(userId, categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    if (existing.isDefault) {
      throw new AppError(400, 'CANNOT_DELETE_DEFAULT_CATEGORY', 'Không thể xóa lịch mặc định của hệ thống')
    }

    await calendarRepository.deleteCategory(userId, categoryId)
    await EventModel.updateMany({ userId, calendarId: categoryId }, { $set: { calendarId: null } })
  },

  // EVENT SERVICES
  getEvents: async (userId: string, filters: EventQueryFilters = {}): Promise<CalendarEventResponse[]> => {
    const events = await calendarRepository.findEvents(userId, filters)
    return events.map((item) => mapEventResponse(item as unknown as RawEventDoc))
  },

  getEventById: async (userId: string, eventId: string): Promise<CalendarEventResponse> => {
    const event = await calendarRepository.findEventById(userId, eventId)
    if (!event) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    return mapEventResponse(event as unknown as RawEventDoc)
  },

  createEvent: async (userId: string, payload: unknown): Promise<CalendarEventResponse> => {
    const data = validateCreateEvent(payload)

    if (data.calendarId) {
      const category = await calendarRepository.findCategoryById(userId, data.calendarId)
      if (category && !data.color) {
        data.color = category.color
      }
    }

    const created = await calendarRepository.createEvent(userId, data)
    const populated = await calendarRepository.findEventById(userId, String(created._id))
    return mapEventResponse((populated ?? created) as unknown as RawEventDoc)
  },

  updateEvent: async (userId: string, eventId: string, payload: unknown): Promise<CalendarEventResponse> => {
    const data = validateUpdateEvent(payload)

    const existing = await calendarRepository.findEventById(userId, eventId)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    if (data.calendarId) {
      const category = await calendarRepository.findCategoryById(userId, data.calendarId)
      if (category && !data.color && !existing.color) {
        data.color = category.color
      }
    }

    const updated = await calendarRepository.updateEvent(userId, eventId, data)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    return mapEventResponse(updated as unknown as RawEventDoc)
  },

  deleteEvent: async (userId: string, eventId: string): Promise<void> => {
    const existing = await calendarRepository.findEventById(userId, eventId)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    await calendarRepository.deleteEvent(userId, eventId)
  },

  toggleTaskComplete: async (
    userId: string,
    eventId: string,
    isCompleted: boolean,
  ): Promise<CalendarEventResponse> => {
    const existing = await calendarRepository.findEventById(userId, eventId)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy nhiệm vụ yêu cầu')
    }

    const updated = await calendarRepository.toggleTaskComplete(userId, eventId, isCompleted)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy nhiệm vụ yêu cầu')
    }

    return mapEventResponse(updated as unknown as RawEventDoc)
  },
}
