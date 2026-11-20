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
    frequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: number
    daysOfWeek?: number[]
    until?: Date | null
    count?: number | null
  }
  createdAt?: Date
  updatedAt?: Date
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
      count: doc.recurrence.count ?? null,
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

    // Nếu sự kiện có lặp lại và có chỉ định chế độ xóa
    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)

      if (mode === 'this') {
        // Chỉ xóa lần lặp này -> Thêm ngày vào danh sách loại trừ exceptionDates
        await EventModel.updateOne(
          { _id: eventId, userId },
          { $addToSet: { exceptionDates: targetDate } },
        )
        return
      }

      if (mode === 'following') {
        // Xóa lần lặp này và các lần tiếp theo -> Cắt recurrence.until trước thời điểm này
        const baseStart = new Date(existing.startDate)
        if (targetDate.getTime() <= baseStart.getTime()) {
          // Nếu mốc xóa từ sự kiện gốc trở đi -> Xóa toàn bộ
          await calendarRepository.deleteEvent(userId, eventId)
          return
        }
        const untilDate = new Date(targetDate.getTime() - 1000)
        await EventModel.updateOne(
          { _id: eventId, userId },
          { $set: { 'recurrence.until': untilDate } },
        )
        return
      }
    }

    // Mặc định hoặc mode === 'all': xóa toàn bộ sự kiện
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

  exportCategoryIcs: async (userId: string, categoryId: string): Promise<{ icsContent: string; filename: string }> => {
    const category = await calendarRepository.findCategoryById(userId, categoryId)
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const events = await calendarRepository.findEvents(userId, { calendarId: categoryId })
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
      color: category.color || '#2563EB',
      availability: 'busy' as const,
      visibility: 'default' as const,
      isCompleted: false,
    }))

    await EventModel.insertMany(docsToInsert)
    return { importedCount: docsToInsert.length }
  },
}
