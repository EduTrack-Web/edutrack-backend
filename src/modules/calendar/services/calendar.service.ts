import { Types } from 'mongoose'
import { AppError } from '../../../shared/errors/app-error.js'
import { CalendarCategoryModel } from '../models/calendar-category.model.js'
import { EventModel } from '../models/event.model.js'
import { calendarRepository } from '../repositories/calendar.repository.js'
import { UserModel } from '@/modules/auth/models/user.model.js'
import { NotificationModel } from '@/modules/notifications/models/notification.model.js'
import { notificationService } from '@/modules/notifications/services/notification.service.js'
import { sendEventInvitationEmail } from '@/modules/auth/services/email.service.js'
import type {
  CalendarCategoryResponse,
  CalendarEventResponse,
  EventQueryFilters,
  RecurrenceConfig,
  RecurrenceFrequency,
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
  settings?: CalendarCategoryResponse['settings']
  sharedWith?: CalendarCategoryResponse['sharedWith']
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
  deadline?: Date | null
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: 'busy' | 'free'
  visibility?: 'default' | 'public' | 'private'
  timeZone?: string
  guests?: CalendarEventResponse['guests']
  isCompleted?: boolean
  completedAt?: Date | null
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: {
    frequency: RecurrenceFrequency
    interval: number
    daysOfWeek?: number[]
    until?: Date | null
    count?: number | null
  }
  exceptionDates?: (Date | string)[]
  recurringEventId?: unknown
  originalStartDate?: Date | string | null
  createdAt?: Date
  updatedAt?: Date
}

const toDateKey = (date: Date | string, timeZone = 'Asia/Ho_Chi_Minh'): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(date))
  } catch {
    return new Date(date).toISOString().slice(0, 10)
  }
}

const resolveCategoryObjectId = (val: unknown): Types.ObjectId | null => {
  if (!val) return null
  if (val instanceof Types.ObjectId) return val
  if (typeof val === 'object' && '_id' in val) {
    const inner = (val as { _id: unknown })._id
    if (inner instanceof Types.ObjectId) return inner
    if (typeof inner === 'string' && Types.ObjectId.isValid(inner)) return new Types.ObjectId(inner)
  }
  if (typeof val === 'string' && Types.ObjectId.isValid(val)) {
    return new Types.ObjectId(val)
  }
  return null
}

const mapCategoryResponse = (doc: RawCategoryDoc): CalendarCategoryResponse => ({
  id: String(doc._id),
  userId: String(doc.userId),
  name: doc.name,
  color: doc.color,
  settings: doc.settings,
  sharedWith: doc.sharedWith ?? doc.settings?.sharedWith ?? [],
  description: doc.description ?? '',
  isVisible: doc.isVisible ?? true,
  isDefault: Boolean(doc.isDefault),
  createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
  updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
})

const mapEventResponse = (doc: RawEventDoc): CalendarEventResponse => {
  let calendarInfo: CalendarCategoryResponse | null = null
  let rawCalendarId: string | null = null

  let creatorInfo: { id: string; email: string; fullName: string } | undefined
  let rawUserId = ''

  if (doc.userId && typeof doc.userId === 'object' && '_id' in doc.userId) {
    const popUser = doc.userId as { _id: unknown; email?: string; fullName?: string }
    rawUserId = String(popUser._id)
    creatorInfo = {
      id: rawUserId,
      email: popUser.email ?? '',
      fullName: popUser.fullName ?? '',
    }
  } else if (doc.userId) {
    rawUserId = String(doc.userId)
  }

  if (doc.calendarId && typeof doc.calendarId === 'object' && '_id' in doc.calendarId) {
    const pop = doc.calendarId as RawPopulatedCategory
    rawCalendarId = String(pop._id)
    calendarInfo = {
      id: String(pop._id),
      userId: rawUserId,
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
      count: doc.recurrence.count ?? null,
    }
  }

  return {
    id: String(doc._id),
    userId: rawUserId,
    creator: creatorInfo,
    creatorEmail: creatorInfo?.email ?? '',
    calendarId: rawCalendarId,
    calendar: calendarInfo,
    entryType: doc.entryType,
    title: doc.title,
    description: doc.description ?? '',
    priority: doc.priority,
    startDate: doc.startDate.toISOString(),
    endDate: doc.endDate.toISOString(),
    deadline: doc.deadline ? doc.deadline.toISOString() : null,
    isAllDay: Boolean(doc.isAllDay),
    location: doc.location ?? '',
    onlineMeetingUrl: doc.onlineMeetingUrl ?? '',
    submissionUrl: doc.submissionUrl ?? '',
    inheritsCalendarColor: doc.entryType === 'event' && !doc.color,
    color:
      doc.color ||
      (doc.entryType === 'task'
        ? doc.priority === 'urgent'
          ? '#EF4444'
          : doc.priority === 'high'
            ? '#F59E0B'
            : doc.priority === 'low'
              ? '#64748B'
              : '#3B82F6'
        : calendarInfo
          ? calendarInfo.color
          : '#2563EB'),
    availability: doc.availability ?? 'busy',
    visibility: doc.visibility ?? 'default',
    timeZone: doc.timeZone ?? '',
    guests: Array.isArray(doc.guests) ? doc.guests : [],
    isCompleted: Boolean(doc.isCompleted),
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    checklist: Array.isArray(doc.checklist) ? doc.checklist : [],
    reminders: Array.isArray(doc.reminders) ? doc.reminders : [{ method: 'in-app', minutesBefore: 15 }],
    recurrence: formattedRecurrence,
    exceptionDates: Array.isArray((doc as unknown as { exceptionDates?: (Date | string)[] }).exceptionDates)
      ? (doc as unknown as { exceptionDates: (Date | string)[] }).exceptionDates.map((d) =>
          d instanceof Date ? d.toISOString() : new Date(d).toISOString(),
        )
      : [],
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
  }
}


export const calendarService = {
  getCategories: async (userId: string): Promise<CalendarCategoryResponse[]> => {
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

  getEvents: async (userId: string, filters: EventQueryFilters = {}): Promise<CalendarEventResponse[]> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    const events = await calendarRepository.findEvents(userId, user?.email, filters)
    return events.map((item) => mapEventResponse(item as unknown as RawEventDoc))
  },

  getEventById: async (userId: string, eventId: string): Promise<CalendarEventResponse> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    const event = await calendarRepository.findEventById(userId, eventId, user?.email)
    if (!event) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    return mapEventResponse(event as unknown as RawEventDoc)
  },

  createEvent: async (userId: string, payload: unknown): Promise<CalendarEventResponse> => {
    const data = validateCreateEvent(payload)

    const creator = await UserModel.findById(userId).select('email fullName').lean()
    const creatorEmail = creator?.email?.trim().toLowerCase()

    if (data.guests && data.guests.length > 0) {
      for (const guest of data.guests) {
        const identifier = guest.email.trim().toLowerCase()
        if (!identifier.includes('@')) {
          const found = await UserModel.findOne({
            username: new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            status: { $ne: 'locked' },
          }).select('email').lean()
          if (found?.email) {
            guest.email = found.email.toLowerCase()
          } else {
            throw new AppError(400, 'USER_NOT_FOUND', `Không tìm thấy tài khoản với tên người dùng "${identifier}".`)
          }
        }
      }
    }

    if (data.guests && creatorEmail) {
      data.guests = data.guests.filter((g) => g.email.trim().toLowerCase() !== creatorEmail)
    }

    if (!data.calendarId && data.entryType === 'task' && !data.color) {
      const priorityColorMap: Record<string, string> = {
        urgent: '#EF4444',
        high: '#F59E0B',
        medium: '#3B82F6',
        low: '#64748B',
      }
      data.color = (data.priority && priorityColorMap[data.priority]) || '#3B82F6'
    }

    const created = await calendarRepository.createEvent(userId, data)
    const populated = await calendarRepository.findEventById(userId, String(created._id))
    const result = mapEventResponse((populated ?? created) as unknown as RawEventDoc)

    if (data.guests && data.guests.length > 0) {
      const creatorName = creator?.fullName || 'Người dùng EduTrack'

      for (const guest of data.guests) {
        const cleanEmail = guest.email.trim().toLowerCase()
        if (creatorEmail && cleanEmail === creatorEmail) {
          continue
        }

        const escaped = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const targetUser = await UserModel.findOne({
          email: new RegExp(`^${escaped}$`, 'i'),
          status: { $ne: 'locked' },
        }).lean()

        if (targetUser) {
          void notificationService.createNotification({
            userId: String(targetUser._id),
            type: 'event_invitation',
            title: `Lời mời tham gia sự kiện: ${result.title}`,
            message: `${creatorName} đã mời bạn tham gia sự kiện "${result.title}".`,
            eventId: result.id,
            link: '/calendar',
            metadata: {
              status: 'pending',
              startDate: result.startDate,
              location: result.location,
            },
          })
        }

        void sendEventInvitationEmail(cleanEmail, {
          title: result.title,
          creatorName,
          startDate: new Date(result.startDate),
          endDate: new Date(result.endDate),
          location: result.location,
          onlineMeetingUrl: result.onlineMeetingUrl,
          description: result.description,
        })
      }
    }

    return result
  },

  updateEvent: async (userId: string, eventId: string, payload: unknown): Promise<CalendarEventResponse> => {
    let data = validateUpdateEvent(payload)
    const user = await UserModel.findById(userId).select('email fullName').lean()

    const existing = await calendarRepository.findEventById(userId, eventId, user?.email)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    const rawOwnerId =
      existing.userId && typeof existing.userId === 'object' && '_id' in existing.userId
        ? String((existing.userId as { _id: unknown })._id)
        : String(existing.userId)
    const isOwner = rawOwnerId === userId

    const creator = await UserModel.findById(rawOwnerId).select('email fullName').lean()
    const creatorEmail = creator?.email?.trim().toLowerCase()

    if (!isOwner) {
      const currentGuest = existing.guests?.find(
        (g) => Boolean(user?.email && g.email.toLowerCase() === user.email.toLowerCase()),
      )
      if (!currentGuest) {
        throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền thao tác trên sự kiện này')
      }

      if (!currentGuest.canModify) {
        if (!currentGuest.canInviteOthers) {
          throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền chỉnh sửa sự kiện này')
        }
        data = { guests: data.guests }
      } else {
        delete data.calendarId
      }
    }

    if (data.guests && data.guests.length > 0) {
      for (const guest of data.guests) {
        const identifier = guest.email.trim().toLowerCase()
        if (!identifier.includes('@')) {
          const found = await UserModel.findOne({
            username: new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            status: { $ne: 'locked' },
          }).select('email').lean()
          if (found?.email) {
            guest.email = found.email.toLowerCase()
          } else {
            throw new AppError(400, 'USER_NOT_FOUND', `Không tìm thấy tài khoản với tên người dùng "${identifier}".`)
          }
        }
      }
    }

    if (data.guests && creatorEmail) {
      const hasCreatorAsGuest = data.guests.some(
        (g) => g.email.trim().toLowerCase() === creatorEmail,
      )
      if (hasCreatorAsGuest) {
        throw new AppError(400, 'CANNOT_INVITE_CREATOR', 'Không thể mời lại người tạo sự kiện.')
      }
    }

    if (!isOwner && data.guests && existing.guests) {
      const existingGuestMap = new Map(
        existing.guests.map((g) => [g.email.toLowerCase(), g]),
      )

      data.guests = data.guests.map((g) => {
        const cleanEmail = g.email.trim().toLowerCase()
        const old = existingGuestMap.get(cleanEmail)
        if (old) {
          return {
            ...old,
            email: cleanEmail,
            role: old.role,
            canModify: old.canModify,
            canInviteOthers: old.canInviteOthers,
            canSeeGuestList: old.canSeeGuestList,
            status: old.status,
          }
        }
        return {
          email: cleanEmail,
          role: 'viewer',
          canModify: false,
          canInviteOthers: true,
          canSeeGuestList: true,
          status: 'pending',
        }
      })
    }

    const mode = data.mode
    const targetDateStr = data.targetDate
    delete data.mode
    delete data.targetDate

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)
      const baseStart = new Date(existing.startDate)
      const origDuration = Math.max(0, new Date(existing.endDate).getTime() - baseStart.getTime())
      const eventZone = data.timeZone || existing.timeZone || 'Asia/Ho_Chi_Minh'
      const targetDateKey = toDateKey(targetDate, eventZone)
      const baseStartKey = toDateKey(baseStart, eventZone)
      const resolvedCalendarId =
        data.calendarId !== undefined
          ? resolveCategoryObjectId(data.calendarId)
          : resolveCategoryObjectId(existing.calendarId)
      const resolvedDeadline =
        data.deadline !== undefined
          ? data.deadline
            ? new Date(data.deadline)
            : null
          : existing.deadline
            ? new Date(existing.deadline)
            : null

      if (mode === 'this') {
        await EventModel.updateOne(
          { _id: eventId },
          { $addToSet: { exceptionDates: targetDate } },
        )

        const rawEventData = {
          userId: new Types.ObjectId(rawOwnerId),
          calendarId: resolvedCalendarId,
          entryType: data.entryType || existing.entryType,
          title: data.title || existing.title,
          description: data.description !== undefined ? data.description : (existing.description ?? ''),
          priority: data.priority || existing.priority,
          startDate: data.startDate ? new Date(data.startDate) : targetDate,
          endDate: data.endDate ? new Date(data.endDate) : new Date(targetDate.getTime() + origDuration),
          deadline: resolvedDeadline,
          isAllDay: data.isAllDay !== undefined ? data.isAllDay : existing.isAllDay,
          location: data.location !== undefined ? data.location : (existing.location ?? ''),
          onlineMeetingUrl:
            data.onlineMeetingUrl !== undefined ? data.onlineMeetingUrl : (existing.onlineMeetingUrl ?? ''),
          submissionUrl: data.submissionUrl !== undefined ? data.submissionUrl : (existing.submissionUrl ?? ''),
          color: data.color ?? existing.color,
          availability: data.availability || existing.availability,
          visibility: data.visibility || existing.visibility,
          timeZone: data.timeZone ?? existing.timeZone,
          guests: data.guests || existing.guests,
          checklist: data.checklist || existing.checklist,
          reminders: data.reminders || existing.reminders,
          recurrence: { frequency: 'none' as const, interval: 1, daysOfWeek: [], until: null, count: null },
          exceptionDates: [],
          recurringEventId: new Types.ObjectId(eventId),
          originalStartDate: targetDate,
          remindersSent: [],
        }

        const createdStandalone = await EventModel.create(rawEventData)
        const populated = await calendarRepository.findEventById(
          rawOwnerId,
          String(createdStandalone._id),
          user?.email,
        )
        return mapEventResponse((populated ?? createdStandalone) as unknown as RawEventDoc)
      }

      if (mode === 'following' && targetDateKey > baseStartKey) {
        const untilDate = new Date(targetDate.getTime() - 1000)
        const existingExceptions = Array.isArray(existing.exceptionDates)
          ? existing.exceptionDates.map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
          : []
        const pastExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) < targetDateKey)
        const futureExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) > targetDateKey)

        await EventModel.updateOne(
          { _id: eventId },
          {
            $set: {
              'recurrence.until': untilDate,
              'recurrence.count': null,
              exceptionDates: pastExceptions,
            },
          },
        )

        const newStart = data.startDate ? new Date(data.startDate) : targetDate
        const newEnd = data.endDate ? new Date(data.endDate) : new Date(newStart.getTime() + origDuration)

        const rawEventData = {
          userId: new Types.ObjectId(rawOwnerId),
          calendarId: resolvedCalendarId,
          entryType: data.entryType || existing.entryType,
          title: data.title || existing.title,
          description: data.description !== undefined ? data.description : (existing.description ?? ''),
          priority: data.priority || existing.priority,
          startDate: newStart,
          endDate: newEnd,
          deadline: resolvedDeadline,
          isAllDay: data.isAllDay !== undefined ? data.isAllDay : existing.isAllDay,
          location: data.location !== undefined ? data.location : (existing.location ?? ''),
          onlineMeetingUrl:
            data.onlineMeetingUrl !== undefined ? data.onlineMeetingUrl : (existing.onlineMeetingUrl ?? ''),
          submissionUrl: data.submissionUrl !== undefined ? data.submissionUrl : (existing.submissionUrl ?? ''),
          color: data.color ?? existing.color,
          availability: data.availability || existing.availability,
          visibility: data.visibility || existing.visibility,
          timeZone: data.timeZone ?? existing.timeZone,
          guests: data.guests || existing.guests,
          checklist: data.checklist || existing.checklist,
          reminders: data.reminders || existing.reminders,
          recurrence: data.recurrence
            ? {
                frequency: data.recurrence.frequency,
                interval: data.recurrence.interval || 1,
                daysOfWeek: data.recurrence.daysOfWeek || [],
                until: data.recurrence.until
                  ? new Date(data.recurrence.until)
                  : existing.recurrence.until
                    ? new Date(existing.recurrence.until)
                    : null,
                count: null,
              }
            : {
                frequency: (existing.recurrence.frequency || 'daily') as RecurrenceFrequency,
                interval: existing.recurrence.interval || 1,
                daysOfWeek: existing.recurrence.daysOfWeek || [],
                until: existing.recurrence.until ? new Date(existing.recurrence.until) : null,
                count: null,
              },
          exceptionDates: futureExceptions,
          remindersSent: [],
        }

        const createdFollowing = await EventModel.create(rawEventData)
        await EventModel.updateMany(
          {
            userId: new Types.ObjectId(rawOwnerId),
            recurringEventId: new Types.ObjectId(eventId),
            originalStartDate: { $gte: targetDate },
          },
          { $set: { recurringEventId: createdFollowing._id } },
        )

        const populated = await calendarRepository.findEventById(
          rawOwnerId,
          String(createdFollowing._id),
          user?.email,
        )
        return mapEventResponse((populated ?? createdFollowing) as unknown as RawEventDoc)
      }

      if (mode === 'all_this_weekday') {
        const targetDow = targetDate.getDay()
        const existingDays =
          Array.isArray(existing.recurrence.daysOfWeek) && existing.recurrence.daysOfWeek.length > 0
            ? existing.recurrence.daysOfWeek
            : existing.recurrence.frequency === 'weekdays'
              ? [1, 2, 3, 4, 5]
              : []

        if (existingDays.includes(targetDow)) {
          const remainingDays = existingDays.filter((d: number) => d !== targetDow)
          if (remainingDays.length > 0) {
            await EventModel.updateOne(
              { _id: eventId },
              { $set: { 'recurrence.frequency': 'custom', 'recurrence.daysOfWeek': remainingDays } },
            )
          } else {
            await EventModel.deleteOne({ _id: eventId })
          }

          const newStart = data.startDate ? new Date(data.startDate) : targetDate
          const newDow = newStart.getDay()
          const newEnd = data.endDate ? new Date(data.endDate) : new Date(newStart.getTime() + origDuration)

          const rawEventData = {
            userId: new Types.ObjectId(rawOwnerId),
            calendarId: resolvedCalendarId,
            entryType: data.entryType || existing.entryType,
            title: data.title || existing.title,
            description: data.description !== undefined ? data.description : (existing.description ?? ''),
            priority: data.priority || existing.priority,
            startDate: newStart,
            endDate: newEnd,
            deadline: resolvedDeadline,
            isAllDay: data.isAllDay !== undefined ? data.isAllDay : existing.isAllDay,
            location: data.location !== undefined ? data.location : (existing.location ?? ''),
            onlineMeetingUrl:
              data.onlineMeetingUrl !== undefined ? data.onlineMeetingUrl : (existing.onlineMeetingUrl ?? ''),
            submissionUrl: data.submissionUrl !== undefined ? data.submissionUrl : (existing.submissionUrl ?? ''),
            color: data.color ?? existing.color,
            availability: data.availability || existing.availability,
            visibility: data.visibility || existing.visibility,
            timeZone: data.timeZone ?? existing.timeZone,
            guests: data.guests || existing.guests,
            checklist: data.checklist || existing.checklist,
            reminders: data.reminders || existing.reminders,
            recurrence: {
              frequency: 'custom' as const,
              interval: existing.recurrence.interval || 1,
              daysOfWeek: [newDow],
              until: existing.recurrence.until ? new Date(existing.recurrence.until) : null,
              count: null,
            },
            exceptionDates: [],
            remindersSent: [],
          }

          const createdWeekdaySeries = await EventModel.create(rawEventData)
          const populated = await calendarRepository.findEventById(
            rawOwnerId,
            String(createdWeekdaySeries._id),
            user?.email,
          )
          return mapEventResponse((populated ?? createdWeekdaySeries) as unknown as RawEventDoc)
        }
      }
    }

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && data.startDate && data.endDate) {
      const origBaseStart = new Date(existing.startDate)
      const newStart = new Date(data.startDate)
      const duration = Math.max(0, new Date(data.endDate).getTime() - newStart.getTime())

      const updatedBaseStart = new Date(origBaseStart)
      if (targetDateStr) {
        const dayDiff = Math.round((newStart.getTime() - new Date(targetDateStr).getTime()) / (24 * 3600 * 1000))
        if (dayDiff !== 0) {
          updatedBaseStart.setDate(updatedBaseStart.getDate() + dayDiff)
        }
      }
      updatedBaseStart.setHours(
        newStart.getHours(),
        newStart.getMinutes(),
        newStart.getSeconds(),
        newStart.getMilliseconds(),
      )
      const updatedBaseEnd = new Date(updatedBaseStart.getTime() + duration)

      data.startDate = updatedBaseStart.toISOString()
      data.endDate = updatedBaseEnd.toISOString()

      if (data.recurrence && data.recurrence.frequency === 'none') {
        data.exceptionDates = []
      }
    }

    const updated = await calendarRepository.updateEvent(rawOwnerId, eventId, data)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    const result = mapEventResponse(updated as unknown as RawEventDoc)

    if (isOwner && data.guests && existing.guests) {
      for (const guest of data.guests) {
        const oldGuest = existing.guests.find(
          (og) => og.email.trim().toLowerCase() === guest.email.trim().toLowerCase(),
        )
        if (oldGuest && !oldGuest.canModify && guest.canModify) {
          const targetUser = await UserModel.findOne({
            email: new RegExp(`^${guest.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            status: { $ne: 'locked' },
          }).lean()

          if (targetUser) {
            void notificationService.createNotification({
              userId: String(targetUser._id),
              type: 'event_update',
              title: `Cập nhật quyền sự kiện: ${result.title}`,
              message: `${user?.fullName || 'Người tạo'} đã cấp quyền chỉnh sửa sự kiện "${result.title}" cho bạn.`,
              eventId: result.id,
              link: '/calendar',
            })
          }
        }
      }
    }

    if (!isOwner) {
      void notificationService.createNotification({
        userId: rawOwnerId,
        type: 'event_update',
        title: `Sự kiện đã được chỉnh sửa: ${result.title}`,
        message: `${user?.fullName || user?.email || 'Khách mời'} đã cập nhật nội dung sự kiện "${result.title}".`,
        eventId: result.id,
        link: '/calendar',
      })
    }

    if (data.guests && data.guests.length > 0) {
      const oldEmails = new Set((existing.guests || []).map((g) => g.email.toLowerCase()))
      const newGuests = data.guests.filter((g) => !oldEmails.has(g.email.toLowerCase()))
      const inviterName = user?.fullName || 'Người dùng EduTrack'

      for (const guest of newGuests) {
        const cleanEmail = guest.email.trim().toLowerCase()
        if (user?.email && cleanEmail === user.email.trim().toLowerCase()) continue
        if (creatorEmail && cleanEmail === creatorEmail) continue

        const escaped = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const targetUser = await UserModel.findOne({
          email: new RegExp(`^${escaped}$`, 'i'),
          status: { $ne: 'locked' },
        }).lean()

        if (targetUser) {
          void notificationService.createNotification({
            userId: String(targetUser._id),
            type: 'event_invitation',
            title: `Lời mời tham gia sự kiện: ${result.title}`,
            message: `${inviterName} đã mời bạn tham gia sự kiện "${result.title}".`,
            eventId: result.id,
            link: '/calendar',
            metadata: {
              status: 'pending',
              startDate: result.startDate,
              location: result.location,
            },
          })
        }

        void sendEventInvitationEmail(cleanEmail, {
          title: result.title,
          creatorName: inviterName,
          startDate: new Date(result.startDate),
          endDate: new Date(result.endDate),
          location: result.location,
          onlineMeetingUrl: result.onlineMeetingUrl,
          description: result.description,
        })
      }
    }

    return result
  },

  respondEventInvitation: async (
    userId: string,
    eventId: string,
    status: 'accepted' | 'declined',
  ): Promise<CalendarEventResponse> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    if (!user?.email) {
      throw new AppError(400, 'USER_EMAIL_MISSING', 'Không tìm thấy email của tài khoản.')
    }

    const updated = await calendarRepository.respondEventInvitation(eventId, user.email, status)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy lời mời sự kiện.')
    }

    const guestUserObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId
    const eventObjId = Types.ObjectId.isValid(eventId) ? new Types.ObjectId(eventId) : eventId
    await NotificationModel.updateMany(
      {
        $and: [
          { $or: [{ userId: guestUserObjId }, { userId }] },
          { $or: [{ eventId: eventObjId }, { eventId }] },
          { type: 'event_invitation' },
        ],
      },
      {
        $set: {
          isRead: true,
          'metadata.status': status,
        },
      },
    )

    const result = mapEventResponse(updated as unknown as RawEventDoc)

    const guestName = user.fullName || user.email
    const statusLabel = status === 'accepted' ? 'chấp nhận' : 'từ chối'
    const ownerId =
      updated.userId && typeof updated.userId === 'object' && '_id' in updated.userId
        ? String((updated.userId as { _id: unknown })._id)
        : String(updated.userId)

    void notificationService.createNotification({
      userId: ownerId,
      type: 'event_response',
      title: `Phản hồi lời mời: ${result.title}`,
      message: `${guestName} đã ${statusLabel} lời mời tham gia sự kiện "${result.title}".`,
      eventId: result.id,
      link: '/calendar',
    })

    return result
  },

  leaveEvent: async (userId: string, eventId: string): Promise<void> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    if (!user?.email) {
      throw new AppError(400, 'USER_EMAIL_MISSING', 'Không tìm thấy email của tài khoản.')
    }

    const updated = await calendarRepository.leaveEvent(eventId, user.email)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện.')
    }

    const guestUserObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId
    const eventObjId = Types.ObjectId.isValid(eventId) ? new Types.ObjectId(eventId) : eventId
    await NotificationModel.updateMany(
      {
        $and: [
          { $or: [{ userId: guestUserObjId }, { userId }] },
          { $or: [{ eventId: eventObjId }, { eventId }] },
          { type: 'event_invitation' },
        ],
      },
      {
        $set: {
          isRead: true,
          'metadata.status': 'declined',
        },
      },
    )

    const guestName = user.fullName || user.email
    const ownerId =
      updated.userId && typeof updated.userId === 'object' && '_id' in updated.userId
        ? String((updated.userId as { _id: unknown })._id)
        : String(updated.userId)

    void notificationService.createNotification({
      userId: ownerId,
      type: 'event_update',
      title: `Rời khỏi sự kiện: ${updated.title}`,
      message: `${guestName} đã rời khỏi sự kiện "${updated.title}".`,
      eventId: String(updated._id),
      link: '/calendar',
    })
  },

  deleteEvent: async (
    userId: string,
    eventId: string,
    mode?: 'this' | 'following' | 'all',
    targetDateStr?: string,
  ): Promise<void> => {
    const existing = await calendarRepository.findEventById(userId, eventId)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)
      const baseStart = new Date(existing.startDate)
      const eventZone = existing.timeZone || 'Asia/Ho_Chi_Minh'
      const targetDateKey = toDateKey(targetDate, eventZone)
      const baseStartKey = toDateKey(baseStart, eventZone)

      if (mode === 'this') {
        await EventModel.updateOne(
          { _id: eventId, userId },
          { $addToSet: { exceptionDates: targetDate } },
        )
        return
      }

      if (mode === 'following') {
        if (targetDateKey <= baseStartKey) {
          await calendarRepository.deleteEvent(userId, eventId)
          await EventModel.deleteMany({ userId, recurringEventId: eventId })
          return
        }
        const untilDate = new Date(targetDate.getTime() - 1000)
        const existingExceptions = Array.isArray(existing.exceptionDates)
          ? existing.exceptionDates.map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
          : []
        const pastExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) < targetDateKey)

        await EventModel.updateOne(
          { _id: eventId, userId },
          {
            $set: {
              'recurrence.until': untilDate,
              'recurrence.count': null,
              exceptionDates: pastExceptions,
            },
          },
        )
        await EventModel.deleteMany({
          userId,
          recurringEventId: eventId,
          originalStartDate: { $gte: targetDate },
        })
        return
      }
    }

    await calendarRepository.deleteEvent(userId, eventId)
    if (existing.recurrence && existing.recurrence.frequency !== 'none') {
      await EventModel.deleteMany({ userId, recurringEventId: eventId })
    }
  },

  toggleTaskComplete: async (
    userId: string,
    eventId: string,
    isCompleted: boolean,
    mode?: 'this' | 'following' | 'all',
    targetDateStr?: string,
  ): Promise<CalendarEventResponse> => {
    const existing = await calendarRepository.findEventById(userId, eventId)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy nhiệm vụ yêu cầu')
    }

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)
      const baseStart = new Date(existing.startDate)
      const origDuration = Math.max(0, new Date(existing.endDate).getTime() - baseStart.getTime())
      const eventZone = existing.timeZone || 'Asia/Ho_Chi_Minh'
      const targetDateKey = toDateKey(targetDate, eventZone)
      const baseStartKey = toDateKey(baseStart, eventZone)
      const completedAt = isCompleted ? new Date() : null

      if (mode === 'this') {
        await EventModel.updateOne(
          { _id: eventId, userId },
          { $addToSet: { exceptionDates: targetDate } },
        )

        const createdStandalone = await EventModel.create({
          userId: new Types.ObjectId(userId),
          calendarId: resolveCategoryObjectId(existing.calendarId),
          entryType: existing.entryType,
          title: existing.title,
          description: existing.description ?? '',
          priority: existing.priority,
          startDate: targetDate,
          endDate: new Date(targetDate.getTime() + origDuration),
          isAllDay: existing.isAllDay,
          location: existing.location ?? '',
          onlineMeetingUrl: existing.onlineMeetingUrl ?? '',
          submissionUrl: existing.submissionUrl ?? '',
          color: existing.color,
          availability: existing.availability,
          visibility: existing.visibility,
          timeZone: existing.timeZone,
          guests: existing.guests || [],
          checklist: existing.checklist || [],
          reminders: existing.reminders || [],
          isCompleted,
          completedAt,
          recurrence: { frequency: 'none' as const, interval: 1, daysOfWeek: [], until: null, count: null },
          exceptionDates: [],
          recurringEventId: new Types.ObjectId(eventId),
          originalStartDate: targetDate,
          remindersSent: [],
        })
        return mapEventResponse(createdStandalone as unknown as RawEventDoc)
      }

      if (mode === 'following' && targetDateKey > baseStartKey) {
        const untilDate = new Date(targetDate.getTime() - 1000)
        const existingExceptions = Array.isArray(existing.exceptionDates)
          ? existing.exceptionDates.map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
          : []
        const pastExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) < targetDateKey)
        const futureExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) > targetDateKey)

        await EventModel.updateOne(
          { _id: eventId, userId },
          {
            $set: {
              'recurrence.until': untilDate,
              'recurrence.count': null,
              exceptionDates: pastExceptions,
            },
          },
        )

        const createdFollowing = await EventModel.create({
          userId: new Types.ObjectId(userId),
          calendarId: resolveCategoryObjectId(existing.calendarId),
          entryType: existing.entryType,
          title: existing.title,
          description: existing.description ?? '',
          priority: existing.priority,
          startDate: targetDate,
          endDate: new Date(targetDate.getTime() + origDuration),
          isAllDay: existing.isAllDay,
          location: existing.location ?? '',
          onlineMeetingUrl: existing.onlineMeetingUrl ?? '',
          submissionUrl: existing.submissionUrl ?? '',
          color: existing.color,
          availability: existing.availability,
          visibility: existing.visibility,
          timeZone: existing.timeZone,
          guests: existing.guests || [],
          checklist: existing.checklist || [],
          reminders: existing.reminders || [],
          isCompleted,
          completedAt,
          recurrence: {
            frequency: (existing.recurrence.frequency || 'daily') as RecurrenceFrequency,
            interval: existing.recurrence.interval || 1,
            daysOfWeek: existing.recurrence.daysOfWeek || [],
            until: existing.recurrence.until ? new Date(existing.recurrence.until) : null,
            count: null,
          },
          exceptionDates: futureExceptions,
          remindersSent: [],
        })

        await EventModel.updateMany(
          {
            userId: new Types.ObjectId(userId),
            recurringEventId: new Types.ObjectId(eventId),
            originalStartDate: { $gte: targetDate },
          },
          { $set: { recurringEventId: createdFollowing._id } },
        )

        return mapEventResponse(createdFollowing as unknown as RawEventDoc)
      }
    }

    const updated = await calendarRepository.toggleTaskComplete(userId, eventId, isCompleted)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy nhiệm vụ yêu cầu')
    }

    return mapEventResponse(updated as unknown as RawEventDoc)
  },

  exportCategoryIcs: async (userId: string, categoryId: string): Promise<{ icsContent: string; filename: string }> => {
    const category = await calendarRepository.findCategoryById(userId, categoryId)
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const events = await calendarRepository.findEvents(userId, undefined, { calendarId: categoryId })
    const mappedEvents = events.map((item) => mapEventResponse(item as unknown as RawEventDoc))

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
    const formatIcsDate = (dateStr: string, isAllDay: boolean) => {
      const d = new Date(dateStr)
      if (isAllDay) {
        return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
      }
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    }

    const escapeIcs = (str: string) => str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EduTrack//Calendar Module//VI',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcs(category.name)}`,
    ]

    if (category.description) {
      lines.push(`X-WR-CALDESC:${escapeIcs(category.description)}`)
    }
    if (category.settings?.timeZone) {
      lines.push(`X-WR-TIMEZONE:${category.settings.timeZone}`)
    }

    for (const event of mappedEvents) {
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:edutrack-${event.id}@edutrack.app`)
      lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString(), false)}`)
      if (event.isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.startDate, true)}`)
        lines.push(`DTEND;VALUE=DATE:${formatIcsDate(event.endDate, true)}`)
      } else {
        lines.push(`DTSTART:${formatIcsDate(event.startDate, false)}`)
        lines.push(`DTEND:${formatIcsDate(event.endDate, false)}`)
      }
      lines.push(`SUMMARY:${escapeIcs(event.title)}`)
      if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`)
      if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`)
      lines.push('END:VEVENT')
    }

    lines.push('END:VCALENDAR')
    const icsContent = lines.join('\r\n')
    const cleanFilename = category.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'calendar'
    return { icsContent, filename: `${cleanFilename}.ics` }
  },

  importCategoryIcs: async (
    userId: string,
    categoryId: string,
    rawIcsContent: string,
  ): Promise<{ importedCount: number }> => {
    const category = await calendarRepository.findCategoryById(userId, categoryId)
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    if (!rawIcsContent || typeof rawIcsContent !== 'string') {
      throw new AppError(400, 'INVALID_ICS_CONTENT', 'Nội dung file .ics không hợp lệ hoặc rỗng')
    }

    const unfolded = rawIcsContent.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
    const lines = unfolded.split(/\r?\n/)
    const parsedEvents: Array<{
      title: string
      description: string
      startDate: Date
      endDate: Date
      location: string
      isAllDay: boolean
    }> = []

    let inEvent = false
    let currentEvent: Record<string, string> = {}

    const unescapeIcs = (str: string) =>
      str.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')

    const parseIcsDate = (val: string): { date: Date; isAllDay: boolean } | null => {
      const clean = val.trim()
      const dateMatch = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
      if (!dateMatch) {
        const d = new Date(clean)
        if (!Number.isNaN(d.getTime())) {
          return { date: d, isAllDay: false }
        }
        return null
      }
      const [, y, m, d, h, min, s, z] = dateMatch
      if (h !== undefined) {
        if (z) {
          return {
            date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s || 0))),
            isAllDay: false,
          }
        }
        return {
          date: new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s || 0)),
          isAllDay: false,
        }
      }
      return {
        date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)),
        isAllDay: true,
      }
    }

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'BEGIN:VEVENT') {
        inEvent = true
        currentEvent = {}
        continue
      }
      if (trimmed === 'END:VEVENT') {
        if (inEvent && currentEvent.SUMMARY) {
          const startInfo = currentEvent.DTSTART ? parseIcsDate(currentEvent.DTSTART) : null
          let endInfo = currentEvent.DTEND ? parseIcsDate(currentEvent.DTEND) : null
          if (startInfo) {
            if (!endInfo) {
              endInfo = {
                date: new Date(startInfo.date.getTime() + 60 * 60 * 1000),
                isAllDay: startInfo.isAllDay,
              }
            }
            parsedEvents.push({
              title: unescapeIcs(currentEvent.SUMMARY).slice(0, 150),
              description: currentEvent.DESCRIPTION ? unescapeIcs(currentEvent.DESCRIPTION).slice(0, 2000) : '',
              startDate: startInfo.date,
              endDate: endInfo.date,
              location: currentEvent.LOCATION ? unescapeIcs(currentEvent.LOCATION).slice(0, 200) : '',
              isAllDay: startInfo.isAllDay,
            })
          }
        }
        inEvent = false
        currentEvent = {}
        continue
      }
      if (inEvent) {
        const colonIndex = trimmed.indexOf(':')
        if (colonIndex > 0) {
          const propFull = trimmed.slice(0, colonIndex)
          const propValue = trimmed.slice(colonIndex + 1)
          const propName = propFull.split(';')[0]?.toUpperCase() ?? ''
          if (propName) {
            currentEvent[propName] = propValue
          }
        }
      }
    }

    if (parsedEvents.length === 0) {
      throw new AppError(400, 'NO_EVENTS_FOUND', 'Không tìm thấy sự kiện nào trong file .ics')
    }

    const docsToInsert = parsedEvents.map((pe) => ({
      userId,
      calendarId: category._id,
      entryType: 'event' as const,
      title: pe.title,
      description: pe.description,
      priority: 'medium' as const,
      startDate: pe.startDate,
      endDate: pe.endDate,
      isAllDay: pe.isAllDay,
      location: pe.location,
      color: '',
      availability: 'busy' as const,
      visibility: 'default' as const,
      isCompleted: false,
    }))

    await EventModel.insertMany(docsToInsert)
    return { importedCount: docsToInsert.length }
  },
}
