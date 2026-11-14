import { Types } from 'mongoose'
import { CalendarCategoryModel } from '../models/calendar-category.model.js'
import { EventModel } from '../models/event.model.js'
import type {
  CreateCategoryInput,
  CreateEventInput,
  EventQueryFilters,
  UpdateCategoryInput,
  UpdateEventInput,
} from '../types/calendar.types.js'

const isValidObjectId = (id: string): boolean => Types.ObjectId.isValid(id)

// Chỉ giữ 1 mẫu sẵn duy nhất là 'Công việc' theo yêu cầu người dùng
const DEFAULT_CATEGORIES = [
  { name: 'Lịch của tôi', color: '#EAB308', description: 'Lịch cá nhân mặc định', isDefault: true },
]

export const calendarRepository = {
  // CATEGORY / MY CALENDARS METHODS
  findCategoriesByUserId: async (userId: string) => {
    // Tự động dọn dẹp các lịch mẫu cũ theo yêu cầu người dùng
    const legacyNames = [
      'Bài tập & Hạn chót',
      'Tự học - Try hard',
      'Cá nhân & Hoạt động',
      'Học chính khóa',
      'Công việc',
    ]
    const legacyDocs = await CalendarCategoryModel.find({
      userId,
      name: { $in: legacyNames },
    }).lean()

    if (legacyDocs.length > 0) {
      const legacyIds = legacyDocs.map((d) => d._id)
      await CalendarCategoryModel.deleteMany({ _id: { $in: legacyIds } })
      await EventModel.updateMany({ calendarId: { $in: legacyIds } }, { $set: { calendarId: null } })
    }

    let categories = await CalendarCategoryModel.find({ userId }).sort({ createdAt: 1 }).lean()

    // Khởi tạo lịch mặc định duy nhất: 'Lịch của tôi' với màu vàng nếu chưa có
    const hasDefault = categories.some((c) => c.isDefault)
    if (!hasDefault) {
      const existingMyCal = categories.find((c) => c.name.toLowerCase() === 'lịch của tôi')
      if (existingMyCal) {
        await CalendarCategoryModel.updateOne(
          { _id: existingMyCal._id },
          { $set: { isDefault: true, color: '#EAB308' } },
        )
      } else {
        await CalendarCategoryModel.create({
          userId,
          name: 'Lịch của tôi',
          color: '#EAB308',
          description: 'Lịch cá nhân mặc định',
          isDefault: true,
          isVisible: true,
        })
      }
      categories = await CalendarCategoryModel.find({ userId }).sort({ createdAt: 1 }).lean()
    }

    return categories
  },

  findCategoryById: (userId: string, categoryId: string) => {
    if (!isValidObjectId(categoryId)) return null
    return CalendarCategoryModel.findOne({ _id: categoryId, userId }).lean()
  },

  findCategoryByName: (userId: string, name: string) => {
    return CalendarCategoryModel.findOne({ userId, name: new RegExp(`^${name.trim()}$`, 'i') }).lean()
  },

  createCategory: (userId: string, data: CreateCategoryInput) => {
    return CalendarCategoryModel.create({
      userId,
      name: data.name,
      color: data.color ?? '#2563EB',
      description: data.description ?? '',
      isVisible: true,
      isDefault: false,
    })
  },

  updateCategory: (userId: string, categoryId: string, data: UpdateCategoryInput) => {
    if (!isValidObjectId(categoryId)) return null
    return CalendarCategoryModel.findOneAndUpdate(
      { _id: categoryId, userId },
      { $set: data },
      { new: true, runValidators: true },
    ).lean()
  },

  setCategoryVisibility: (userId: string, categoryId: string, isVisible: boolean) => {
    if (!isValidObjectId(categoryId)) return null
    return CalendarCategoryModel.findOneAndUpdate(
      { _id: categoryId, userId },
      { $set: { isVisible } },
      { new: true },
    ).lean()
  },

  setOnlyCategoryVisible: async (userId: string, categoryId: string) => {
    if (!isValidObjectId(categoryId)) return null
    await CalendarCategoryModel.updateMany({ userId }, { $set: { isVisible: false } })
    return CalendarCategoryModel.findOneAndUpdate(
      { _id: categoryId, userId },
      { $set: { isVisible: true } },
      { new: true },
    ).lean()
  },

  setAllCategoriesVisibility: async (userId: string, isVisible: boolean) => {
    await CalendarCategoryModel.updateMany({ userId }, { $set: { isVisible } })
    return CalendarCategoryModel.find({ userId }).sort({ createdAt: 1 }).lean()
  },

  deleteCategory: async (userId: string, categoryId: string) => {
    if (!isValidObjectId(categoryId)) return null
    await EventModel.updateMany({ userId, calendarId: categoryId }, { $set: { calendarId: null } })
    return CalendarCategoryModel.findOneAndDelete({ _id: categoryId, userId }).lean()
  },

  // EVENT REPOSITORY METHODS
  findEvents: (userId: string, filters: EventQueryFilters = {}) => {
    const query: Record<string, unknown> = { userId }

    if (filters.entryType) {
      query.entryType = filters.entryType
    }

    if (filters.calendarId && isValidObjectId(filters.calendarId)) {
      query.calendarId = filters.calendarId
    } else if (filters.calendarIds && filters.calendarIds.length > 0) {
      const validIds = filters.calendarIds.filter(isValidObjectId)
      query.$or = [{ calendarId: { $in: validIds } }, { calendarId: null }]
    }

    if (typeof filters.isCompleted === 'boolean') {
      query.isCompleted = filters.isCompleted
    }

    if (filters.from || filters.to) {
      const dateRangeQuery: Record<string, unknown> = {}
      if (filters.from) {
        const fromDate = new Date(filters.from)
        if (!Number.isNaN(fromDate.getTime())) {
          dateRangeQuery.$gte = fromDate
        }
      }
      if (filters.to) {
        const toDate = new Date(filters.to)
        if (!Number.isNaN(toDate.getTime())) {
          dateRangeQuery.$lte = toDate
        }
      }
      if (Object.keys(dateRangeQuery).length > 0) {
        query.startDate = dateRangeQuery
      }
    }

    if (filters.q && filters.q.trim()) {
      const escaped = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query.$or = [
        { title: new RegExp(escaped, 'i') },
        { location: new RegExp(escaped, 'i') },
        { description: new RegExp(escaped, 'i') },
      ]
    }

    return EventModel.find(query)
      .populate('calendarId', 'name color description isVisible')
      .sort({ startDate: 1 })
      .lean()
  },

  findEventById: (userId: string, eventId: string) => {
    if (!isValidObjectId(eventId)) return null
    return EventModel.findOne({ _id: eventId, userId })
      .populate('calendarId', 'name color description isVisible')
      .lean()
  },

  createEvent: (userId: string, data: CreateEventInput) => {
    return EventModel.create({
      userId,
      title: data.title,
      entryType: data.entryType ?? 'event',
      priority: data.priority ?? 'medium',
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      isAllDay: Boolean(data.isAllDay),
      calendarId: data.calendarId ? new Types.ObjectId(data.calendarId) : null,
      description: data.description ?? '',
      location: data.location ?? '',
      onlineMeetingUrl: data.onlineMeetingUrl ?? '',
      submissionUrl: data.submissionUrl ?? '',
      color: data.color ?? '',
      availability: data.availability ?? 'busy',
      visibility: data.visibility ?? 'default',
      isCompleted: false,
      completedAt: null,
      checklist: data.checklist ?? [],
      reminders: data.reminders ?? [{ method: 'in-app', minutesBefore: 15 }],
      recurrence: data.recurrence ?? { frequency: 'none', interval: 1, daysOfWeek: [], until: null },
    })
  },

  updateEvent: (userId: string, eventId: string, data: UpdateEventInput) => {
    if (!isValidObjectId(eventId)) return null

    const updateFields: Record<string, unknown> = {}
    if ('title' in data) updateFields.title = data.title
    if ('entryType' in data) updateFields.entryType = data.entryType
    if ('priority' in data) updateFields.priority = data.priority
    if ('startDate' in data && data.startDate) updateFields.startDate = new Date(data.startDate)
    if ('endDate' in data && data.endDate) updateFields.endDate = new Date(data.endDate)
    if ('isAllDay' in data) updateFields.isAllDay = data.isAllDay
    if ('calendarId' in data) {
      updateFields.calendarId = data.calendarId ? new Types.ObjectId(data.calendarId) : null
    }
    if ('description' in data) updateFields.description = data.description
    if ('location' in data) updateFields.location = data.location
    if ('onlineMeetingUrl' in data) updateFields.onlineMeetingUrl = data.onlineMeetingUrl
    if ('submissionUrl' in data) updateFields.submissionUrl = data.submissionUrl
    if ('color' in data) updateFields.color = data.color
    if ('availability' in data) updateFields.availability = data.availability
    if ('visibility' in data) updateFields.visibility = data.visibility
    if ('isCompleted' in data) {
      updateFields.isCompleted = data.isCompleted
      updateFields.completedAt = data.isCompleted ? new Date() : null
    }
    if ('checklist' in data) updateFields.checklist = data.checklist
    if ('reminders' in data) updateFields.reminders = data.reminders
    if ('recurrence' in data) updateFields.recurrence = data.recurrence

    return EventModel.findOneAndUpdate(
      { _id: eventId, userId },
      { $set: updateFields },
      { new: true, runValidators: true },
    )
      .populate('calendarId', 'name color description isVisible')
      .lean()
  },

  deleteEvent: (userId: string, eventId: string) => {
    if (!isValidObjectId(eventId)) return null
    return EventModel.findOneAndDelete({ _id: eventId, userId }).lean()
  },

  toggleTaskComplete: (userId: string, eventId: string, isCompleted: boolean) => {
    if (!isValidObjectId(eventId)) return null
    return EventModel.findOneAndUpdate(
      { _id: eventId, userId },
      {
        $set: {
          isCompleted,
          completedAt: isCompleted ? new Date() : null,
        },
      },
      { new: true },
    )
      .populate('calendarId', 'name color description isVisible')
      .lean()
  },
}
