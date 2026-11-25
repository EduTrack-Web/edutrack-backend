import { Types } from 'mongoose'
import { CalendarCategoryModel } from '../models/calendar-category.model.js'
import { EventModel } from '../models/event.model.js'
import { UserModel } from '@/modules/auth/models/user.model.js'
import type {
  CalendarPreferences,
  CreateCategoryInput,
  CreateEventInput,
  EventQueryFilters,
  UpdateCategoryInput,
  UpdateEventInput,
} from '../types/calendar.types.js'

const isValidObjectId = (id: string): boolean => Types.ObjectId.isValid(id)

export const calendarRepository = {
  findCalendarPreferences: (userId: string) =>
    UserModel.findById(userId).select('preferences.calendar').lean(),

  updateCalendarPreferences: (userId: string, preferences: Partial<CalendarPreferences>) => {
    const updateFields: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(preferences)) {
      if (typeof value === 'boolean') {
        updateFields[`preferences.calendar.${key}`] = value
      }
    }

    return UserModel.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true },
    ).select('preferences.calendar').lean()
  },

  findCategoriesByUserId: async (userId: string) => {
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
      settings: data.settings,
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
      { returnDocument: 'after', runValidators: true },
    ).lean()
  },

  setCategoryVisibility: (userId: string, categoryId: string, isVisible: boolean) => {
    if (!isValidObjectId(categoryId)) return null
    return CalendarCategoryModel.findOneAndUpdate(
      { _id: categoryId, userId },
      { $set: { isVisible } },
      { returnDocument: 'after' },
    ).lean()
  },

  setOnlyCategoryVisible: async (userId: string, categoryId: string) => {
    if (!isValidObjectId(categoryId)) return null
    await CalendarCategoryModel.updateMany({ userId }, { $set: { isVisible: false } })
    return CalendarCategoryModel.findOneAndUpdate(
      { _id: categoryId, userId },
      { $set: { isVisible: true } },
      { returnDocument: 'after' },
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

  findEvents: (userId: string, userEmail?: string, filters: EventQueryFilters = {}) => {
    const andConditions: Record<string, unknown>[] = []

    const accessCriteria: Record<string, unknown>[] = [{ userId }]
    if (userEmail) {
      const cleanEmail = userEmail.trim().toLowerCase()
      const emailRegex = new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      accessCriteria.push({
        guests: {
          $elemMatch: {
            email: emailRegex,
            status: 'accepted',
          },
        },
      })
    }
    andConditions.push({ $or: accessCriteria })

    if (filters.entryType) {
      andConditions.push({ entryType: filters.entryType })
    }

    if (filters.calendarId && isValidObjectId(filters.calendarId)) {
      andConditions.push({ calendarId: filters.calendarId })
    } else if (filters.calendarIds && filters.calendarIds.length > 0) {
      const validIds = filters.calendarIds.filter(isValidObjectId)
      const allowedCategories: Record<string, unknown>[] = [
        { calendarId: { $in: validIds } },
        { calendarId: null },
      ]
      if (userEmail) {
        const cleanEmail = userEmail.trim().toLowerCase()
        const emailRegex = new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
        allowedCategories.push({
          guests: {
            $elemMatch: {
              email: emailRegex,
              status: 'accepted',
            },
          },
        })
      }
      andConditions.push({ $or: allowedCategories })
    }

    if (typeof filters.isCompleted === 'boolean') {
      andConditions.push({ isCompleted: filters.isCompleted })
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
        andConditions.push({ startDate: dateRangeQuery })
      }
    }

    if (filters.q && filters.q.trim()) {
      const escaped = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      andConditions.push({
        $or: [
          { title: new RegExp(escaped, 'i') },
          { location: new RegExp(escaped, 'i') },
          { description: new RegExp(escaped, 'i') },
        ],
      })
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions }

    return EventModel.find(query)
      .populate('calendarId', 'name color description isVisible')
      .populate('userId', 'email fullName avatarUrl')
      .sort({ startDate: 1 })
      .lean()
  },

  findEventById: (userId: string, eventId: string, userEmail?: string) => {
    if (!isValidObjectId(eventId)) return null
    const accessCriteria: Record<string, unknown>[] = [{ userId }]
    if (userEmail) {
      const cleanEmail = userEmail.trim().toLowerCase()
      const emailRegex = new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      accessCriteria.push({
        guests: {
          $elemMatch: {
            email: emailRegex,
          },
        },
      })
    }
    return EventModel.findOne({ _id: eventId, $or: accessCriteria })
      .populate('calendarId', 'name color description isVisible')
      .populate('userId', 'email fullName avatarUrl')
      .lean()
  },

  respondEventInvitation: async (eventId: string, userEmail: string, status: 'accepted' | 'declined') => {
    if (!isValidObjectId(eventId)) return null
    const cleanEmail = userEmail.trim().toLowerCase()

    const eventDoc = await EventModel.findById(eventId)
    if (!eventDoc) return null

    const guestIndex = (eventDoc.guests || []).findIndex(
      (g) => Boolean(g.email && g.email.trim().toLowerCase() === cleanEmail),
    )

    const targetGuest = eventDoc.guests[guestIndex]
    if (targetGuest) {
      targetGuest.status = status
    } else {
      eventDoc.guests.push({
        email: cleanEmail,
        role: 'viewer',
        canModify: false,
        canInviteOthers: true,
        canSeeGuestList: true,
        status,
      })
    }

    eventDoc.markModified('guests')
    await eventDoc.save()

    return EventModel.findById(eventId)
      .populate('calendarId', 'name color description isVisible')
      .populate('userId', 'email fullName avatarUrl')
      .lean()
  },

  leaveEvent: async (eventId: string, userEmail: string) => {
    if (!isValidObjectId(eventId)) return null
    const cleanEmail = userEmail.trim().toLowerCase()

    await EventModel.updateOne(
      { _id: eventId },
      { $pull: { guests: { email: cleanEmail } } },
    )

    return EventModel.findById(eventId)
      .populate('calendarId', 'name color description isVisible')
      .populate('userId', 'email fullName avatarUrl')
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
      deadline: data.deadline ? new Date(data.deadline) : null,
      isAllDay: Boolean(data.isAllDay),
      calendarId: data.calendarId ? new Types.ObjectId(data.calendarId) : null,
      description: data.description ?? '',
      location: data.location ?? '',
      onlineMeetingUrl: data.onlineMeetingUrl ?? '',
      submissionUrl: data.submissionUrl ?? '',
      color: data.color ?? '',
      availability: data.availability ?? 'busy',
      visibility: data.visibility ?? 'default',
      timeZone: data.timeZone ?? '',
      guests: data.guests ?? [],
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
    if ('deadline' in data) updateFields.deadline = data.deadline ? new Date(data.deadline) : null
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
    if ('timeZone' in data) updateFields.timeZone = data.timeZone
    if ('guests' in data) updateFields.guests = data.guests
    if ('isCompleted' in data) {
      updateFields.isCompleted = data.isCompleted
      updateFields.completedAt = data.isCompleted ? new Date() : null
    }
    if ('checklist' in data) updateFields.checklist = data.checklist
    if ('reminders' in data) updateFields.reminders = data.reminders
    if ('recurrence' in data) updateFields.recurrence = data.recurrence
    if ('startDate' in data || 'endDate' in data || 'deadline' in data || 'reminders' in data || 'recurrence' in data) {
      updateFields.remindersSent = []
    }

    return EventModel.findOneAndUpdate(
      { _id: eventId, userId },
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true },
    )
      .populate('calendarId', 'name color description isVisible')
      .populate('userId', 'email fullName avatarUrl')
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
      { returnDocument: 'after' },
    )
      .populate('calendarId', 'name color description isVisible')
      .lean()
  },
}
