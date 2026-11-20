import { AppError } from '../../../shared/errors/app-error.js'
import type {
  CalendarSettings,
  CreateCategoryInput,
  CreateEventInput,
  EntryType,
  EventAvailability,
  EventGuest,
  EventPriority,
  EventVisibility,
  RecurrenceConfig,
  ReminderItem,
  SubtaskItem,
  UpdateCategoryInput,
  UpdateEventInput,
} from '../types/calendar.types.js'

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const VALID_ENTRY_TYPES: readonly EntryType[] = ['event', 'task']
const VALID_PRIORITIES: readonly EventPriority[] = ['low', 'medium', 'high', 'urgent']
const VALID_AVAILABILITY: readonly EventAvailability[] = ['busy', 'free']
const VALID_VISIBILITY: readonly EventVisibility[] = ['default', 'public', 'private']
const VALID_RECURRENCE: readonly string[] = [

  'none',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'weekdays',
  'custom',
]

function isValidRecurrenceInput(rec: Record<string, unknown>, startDate: string | undefined): boolean {
  const { frequency, interval, count, until, daysOfWeek } = rec
  return typeof frequency === 'string' && VALID_RECURRENCE.includes(frequency)
    && (interval === undefined || (typeof interval === 'number' && Number.isInteger(interval) && interval >= 1 && interval <= 99))
    && (count == null || (typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 365))
    && (until == null || (typeof until === 'string' && Number.isFinite(Date.parse(until))
      && (!startDate || Date.parse(until) >= Date.parse(startDate))))
    && (daysOfWeek === undefined || (Array.isArray(daysOfWeek)
      && daysOfWeek.every((day: unknown) => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)))
}

const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function validateCalendarSettings(input: unknown, errors: Record<string, string>): CalendarSettings | undefined {
  if (input === undefined) return undefined
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const { timeZone, weekStartsOn, workingHoursStart, workingHoursEnd, defaultDurationMinutes, reminders, privacy, archived, sharedWith } = data
  if (typeof timeZone !== 'string' || timeZone.length > 100) {
    errors.settings = 'Múi giờ không hợp lệ'
    return undefined
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone })
  } catch {
    errors.settings = 'Múi giờ không hợp lệ'
    return undefined
  }
  const timePattern = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/
  const validWeekStart = (weekStartsOn === 0 || weekStartsOn === 1) ? weekStartsOn : 0
  const validWorkStart = typeof workingHoursStart === 'string' && timePattern.test(workingHoursStart) ? workingHoursStart : '08:00'
  const validWorkEnd = typeof workingHoursEnd === 'string' && timePattern.test(workingHoursEnd) ? workingHoursEnd : '17:00'

  if (typeof defaultDurationMinutes !== 'number' || !Number.isInteger(defaultDurationMinutes)
    || defaultDurationMinutes < 5 || defaultDurationMinutes > 1440
    || typeof archived !== 'boolean' || !Array.isArray(reminders) || reminders.length > 10) {
    errors.settings = 'Kiểm tra thời lượng mặc định (5–1440 phút) và danh sách thông báo.'
    return undefined
  }
  const validatedReminders: ReminderItem[] = []
  for (const item of reminders as unknown[]) {
    const reminder = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const { method, minutesBefore } = reminder
    if ((method !== 'in-app' && method !== 'email') || typeof minutesBefore !== 'number'
      || !Number.isInteger(minutesBefore) || minutesBefore < 0 || minutesBefore > 40320
      || validatedReminders.some((entry) => entry.method === method && entry.minutesBefore === minutesBefore)) {
      errors.settings = 'Mốc nhắc phải từ 0 đến 40320 phút và không được trùng kênh cùng thời điểm.'
      return undefined
    }
    validatedReminders.push({ method, minutesBefore })
  }
  const validatedPrivacy = privacy === 'public' ? 'public' : 'private'

  const validatedSharedWith = Array.isArray(sharedWith)
    ? sharedWith
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && typeof s.email === 'string'))
        .map((s) => ({
          email: (s.email as string).trim().toLowerCase(),
          role: s.role === 'admin' ? ('admin' as const) : s.role === 'editor' ? ('editor' as const) : ('viewer' as const),
        }))
    : []

  return {
    timeZone,
    weekStartsOn: validWeekStart,
    workingHoursStart: validWorkStart,
    workingHoursEnd: validWorkEnd,
    defaultDurationMinutes,
    reminders: validatedReminders,
    privacy: validatedPrivacy,
    archived,
    sharedWith: validatedSharedWith,
  }
}

export const validateCreateCategory = (input: unknown): CreateCategoryInput => {
  const errors: Record<string, string> = {}
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const settings = validateCalendarSettings(data.settings, errors)
  const rawName = typeof data.name === 'string' ? data.name.trim() : ''
  if (!rawName) {
    errors.name = 'Vui lòng nhập tên lịch'
  } else if (rawName.length > 100) {
    errors.name = 'Tên lịch không được vượt quá 100 ký tự'
  }

  const rawColor = typeof data.color === 'string' ? data.color.trim() : '#2563EB'
  if (rawColor && !HEX_COLOR_REGEX.test(rawColor)) {
    errors.color = 'Màu sắc phải là mã màu HEX hợp lệ (ví dụ: #2563EB)'
  }

  const rawDescription = typeof data.description === 'string' ? data.description.trim() : ''
  if (rawDescription.length > 500) {
    errors.description = 'Mô tả không được vượt quá 500 ký tự'
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(400, 'CALENDAR_VALIDATION_ERROR', 'Thông tin lịch không hợp lệ', errors)
  }

  return {
    name: rawName,
    color: rawColor || '#2563EB',
    description: rawDescription,
    settings,
  }
}

export const validateUpdateCategory = (input: unknown): UpdateCategoryInput => {
  const errors: Record<string, string> = {}
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const result: UpdateCategoryInput = {}
  const settings = validateCalendarSettings(data.settings, errors)
  if (settings) result.settings = settings

  if ('name' in data) {
    const rawName = typeof data.name === 'string' ? data.name.trim() : ''
    if (!rawName) {
      errors.name = 'Tên lịch không được để trống'
    } else if (rawName.length > 100) {
      errors.name = 'Tên lịch không được vượt quá 100 ký tự'
    } else {
      result.name = rawName
    }
  }

  if ('color' in data) {
    const rawColor = typeof data.color === 'string' ? data.color.trim() : ''
    if (rawColor && !HEX_COLOR_REGEX.test(rawColor)) {
      errors.color = 'Màu sắc phải là mã màu HEX hợp lệ'
    } else {
      result.color = rawColor
    }
  }

  if ('description' in data) {
    const desc = typeof data.description === 'string' ? data.description.trim() : ''
    if (desc.length > 500) {
      errors.description = 'Mô tả không được vượt quá 500 ký tự'
    } else {
      result.description = desc
    }
  }

  if ('isVisible' in data) {
    result.isVisible = Boolean(data.isVisible)
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(400, 'CALENDAR_VALIDATION_ERROR', 'Thông tin cập nhật lịch không hợp lệ', errors)
  }

  return result
}

function parseGuests(guestsInput: unknown): EventGuest[] {
  if (!Array.isArray(guestsInput)) return []
  return guestsInput
    .filter((g): g is Record<string, unknown> => Boolean(g && typeof g === 'object' && typeof g.email === 'string' && g.email.trim()))
    .map((g) => ({
      email: (g.email as string).trim().toLowerCase(),
      role: g.role === 'editor' ? ('editor' as const) : ('viewer' as const),
      canModify: Boolean(g.canModify),
      canInviteOthers: g.canInviteOthers !== undefined ? Boolean(g.canInviteOthers) : true,
      canSeeGuestList: g.canSeeGuestList !== undefined ? Boolean(g.canSeeGuestList) : true,
      status: g.status === 'accepted' || g.status === 'declined' ? g.status : ('pending' as const),
    }))
}

export const validateCreateEvent = (input: unknown): CreateEventInput => {
  const errors: Record<string, string> = {}
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const rawTitle = typeof data.title === 'string' ? data.title.trim() : ''
  if (!rawTitle) {
    errors.title = 'Vui lòng nhập tiêu đề'
  } else if (rawTitle.length > 150) {
    errors.title = 'Tiêu đề không được vượt quá 150 ký tự'
  }

  const rawEntryType = (typeof data.entryType === 'string' ? data.entryType : 'event') as EntryType
  if (!VALID_ENTRY_TYPES.includes(rawEntryType)) {
    errors.entryType = 'Loại sự kiện không hợp lệ'
  }

  const rawPriority = (typeof data.priority === 'string' ? data.priority : 'medium') as EventPriority
  if (!VALID_PRIORITIES.includes(rawPriority)) {
    errors.priority = 'Mức độ ưu tiên không hợp lệ'
  }

  const rawAvailability = (typeof data.availability === 'string' && VALID_AVAILABILITY.includes(data.availability as EventAvailability)
    ? data.availability
    : 'busy') as EventAvailability

  const rawVisibility = (typeof data.visibility === 'string' && VALID_VISIBILITY.includes(data.visibility as EventVisibility)
    ? data.visibility
    : 'default') as EventVisibility

  const rawStartDate = typeof data.startDate === 'string' ? data.startDate.trim() : ''
  const parsedStart = rawStartDate ? new Date(rawStartDate) : null
  if (!rawStartDate || !parsedStart || Number.isNaN(parsedStart.getTime())) {
    errors.startDate = 'Thời gian bắt đầu không hợp lệ'
  }

  const rawEndDate = typeof data.endDate === 'string' ? data.endDate.trim() : ''
  const parsedEnd = rawEndDate ? new Date(rawEndDate) : null
  if (!rawEndDate || !parsedEnd || Number.isNaN(parsedEnd.getTime())) {
    errors.endDate = 'Thời gian kết thúc không hợp lệ'
  }

  if (parsedStart && parsedEnd && !Number.isNaN(parsedStart.getTime()) && !Number.isNaN(parsedEnd.getTime())) {
    if (parsedEnd < parsedStart) {
      errors.endDate = 'Thời gian kết thúc không được sớm hơn thời gian bắt đầu'
    }
  }

  const rawDescription = typeof data.description === 'string' ? data.description.trim() : ''
  if (rawDescription.length > 2000) {
    errors.description = 'Nội dung mô tả không được vượt quá 2000 ký tự'
  }

  const rawLocation = typeof data.location === 'string' ? data.location.trim() : ''
  if (rawLocation.length > 200) {
    errors.location = 'Địa điểm không được vượt quá 200 ký tự'
  }

  const rawMeetingUrl = typeof data.onlineMeetingUrl === 'string' ? data.onlineMeetingUrl.trim() : ''
  if (rawMeetingUrl && !isValidUrl(rawMeetingUrl)) {
    errors.onlineMeetingUrl = 'Link họp trực tuyến không đúng định dạng URL'
  }

  const rawSubmissionUrl = typeof data.submissionUrl === 'string' ? data.submissionUrl.trim() : ''
  if (rawSubmissionUrl && !isValidUrl(rawSubmissionUrl)) {
    errors.submissionUrl = 'Link nộp bài / tài liệu không đúng định dạng URL'
  }

  const rawColor = typeof data.color === 'string' ? data.color.trim() : ''
  if (rawColor && !HEX_COLOR_REGEX.test(rawColor)) {
    errors.color = 'Mã màu không hợp lệ'
  }

  const calendarId = typeof data.calendarId === 'string' && data.calendarId.trim() ? data.calendarId.trim() : null

  let validatedChecklist: SubtaskItem[] = []
  if (Array.isArray(data.checklist)) {
    validatedChecklist = data.checklist
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, idx) => ({
        id: typeof item.id === 'string' ? item.id : `task-${Date.now()}-${idx}`,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        isCompleted: Boolean(item.isCompleted),
      }))
      .filter((item) => item.title.length > 0)
  }

  let validatedReminders: ReminderItem[] = [{ method: 'in-app', minutesBefore: 15 }]
  if (Array.isArray(data.reminders) && data.reminders.length > 0) {
    validatedReminders = data.reminders
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
      .map((r) => ({
        method: r.method === 'email' ? ('email' as const) : ('in-app' as const),
        minutesBefore: typeof r.minutesBefore === 'number' && r.minutesBefore >= 0 ? r.minutesBefore : 15,
      }))
  }

  let validatedRecurrence: RecurrenceConfig | undefined
  if (data.recurrence && typeof data.recurrence === 'object') {
    const rec = data.recurrence as Record<string, unknown>
    if (!isValidRecurrenceInput(rec, rawStartDate)) errors.recurrence = 'Quy tắc lặp lại không hợp lệ. Kiểm tra chu kỳ (1–99), ngày kết thúc và số lần lặp (1–365).'
    const freq = typeof rec.frequency === 'string' && VALID_RECURRENCE.includes(rec.frequency)
      ? (rec.frequency as RecurrenceConfig['frequency'])
      : 'none'
    if (freq !== 'none') {
      validatedRecurrence = {
        frequency: freq,
        interval: typeof rec.interval === 'number' && rec.interval > 0 ? rec.interval : 1,
        daysOfWeek: Array.isArray(rec.daysOfWeek) ? (rec.daysOfWeek as number[]) : [],
        until: typeof rec.until === 'string' ? rec.until : null,
        count: typeof rec.count === 'number' ? rec.count : null,
      }
    }
  }

  const validatedGuests = parseGuests(data.guests)
  const rawTimeZone = typeof data.timeZone === 'string' ? data.timeZone.trim() : ''

  if (Object.keys(errors).length > 0) {
    throw new AppError(400, 'EVENT_VALIDATION_ERROR', 'Thông tin sự kiện không hợp lệ', errors)
  }

  return {
    title: rawTitle,
    entryType: rawEntryType,
    priority: rawPriority,
    startDate: rawStartDate,
    endDate: rawEndDate,
    isAllDay: Boolean(data.isAllDay),
    calendarId,
    description: rawDescription,
    location: rawLocation,
    onlineMeetingUrl: rawMeetingUrl,
    submissionUrl: rawSubmissionUrl,
    color: rawColor,
    availability: rawAvailability,
    visibility: rawVisibility,
    timeZone: rawTimeZone,
    guests: validatedGuests,
    checklist: validatedChecklist,
    reminders: validatedReminders,
    recurrence: validatedRecurrence,
  }
}

export const validateUpdateEvent = (input: unknown): UpdateEventInput => {
  const errors: Record<string, string> = {}
  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const result: UpdateEventInput = {}

  if ('title' in data) {
    const rawTitle = typeof data.title === 'string' ? data.title.trim() : ''
    if (!rawTitle) {
      errors.title = 'Tiêu đề không được để trống'
    } else if (rawTitle.length > 150) {
      errors.title = 'Tiêu đề không được vượt quá 150 ký tự'
    } else {
      result.title = rawTitle
    }
  }

  if ('entryType' in data) {
    const rawEntryType = data.entryType as EntryType
    if (!VALID_ENTRY_TYPES.includes(rawEntryType)) {
      errors.entryType = 'Loại không hợp lệ'
    } else {
      result.entryType = rawEntryType
    }
  }

  if ('priority' in data) {
    const rawPriority = data.priority as EventPriority
    if (!VALID_PRIORITIES.includes(rawPriority)) {
      errors.priority = 'Mức độ ưu tiên không hợp lệ'
    } else {
      result.priority = rawPriority
    }
  }

  if ('availability' in data && typeof data.availability === 'string') {
    if (VALID_AVAILABILITY.includes(data.availability as EventAvailability)) {
      result.availability = data.availability as EventAvailability
    }
  }

  if ('visibility' in data && typeof data.visibility === 'string') {
    if (VALID_VISIBILITY.includes(data.visibility as EventVisibility)) {
      result.visibility = data.visibility as EventVisibility
    }
  }

  let parsedStart: Date | null = null
  let parsedEnd: Date | null = null

  if ('startDate' in data) {
    const rawStartDate = typeof data.startDate === 'string' ? data.startDate.trim() : ''
    parsedStart = rawStartDate ? new Date(rawStartDate) : null
    if (!rawStartDate || !parsedStart || Number.isNaN(parsedStart.getTime())) {
      errors.startDate = 'Thời gian bắt đầu không hợp lệ'
    } else {
      result.startDate = rawStartDate
    }
  }

  if ('endDate' in data) {
    const rawEndDate = typeof data.endDate === 'string' ? data.endDate.trim() : ''
    parsedEnd = rawEndDate ? new Date(rawEndDate) : null
    if (!rawEndDate || !parsedEnd || Number.isNaN(parsedEnd.getTime())) {
      errors.endDate = 'Thời gian kết thúc không hợp lệ'
    } else {
      result.endDate = rawEndDate
    }
  }

  if (parsedStart && parsedEnd && !Number.isNaN(parsedStart.getTime()) && !Number.isNaN(parsedEnd.getTime())) {
    if (parsedEnd < parsedStart) {
      errors.endDate = 'Thời gian kết thúc không được sớm hơn thời gian bắt đầu'
    }
  }

  if ('description' in data) {
    const desc = typeof data.description === 'string' ? data.description.trim() : ''
    if (desc.length > 2000) {
      errors.description = 'Mô tả không được vượt quá 2000 ký tự'
    } else {
      result.description = desc
    }
  }

  if ('location' in data) {
    const loc = typeof data.location === 'string' ? data.location.trim() : ''
    if (loc.length > 200) {
      errors.location = 'Địa điểm không được vượt quá 200 ký tự'
    } else {
      result.location = loc
    }
  }

  if ('onlineMeetingUrl' in data) {
    const url = typeof data.onlineMeetingUrl === 'string' ? data.onlineMeetingUrl.trim() : ''
    if (url && !isValidUrl(url)) {
      errors.onlineMeetingUrl = 'Link trực tuyến không đúng định dạng URL'
    } else {
      result.onlineMeetingUrl = url
    }
  }

  if ('submissionUrl' in data) {
    const url = typeof data.submissionUrl === 'string' ? data.submissionUrl.trim() : ''
    if (url && !isValidUrl(url)) {
      errors.submissionUrl = 'Link nộp bài / tài liệu không đúng định dạng URL'
    } else {
      result.submissionUrl = url
    }
  }

  if ('color' in data) {
    const col = typeof data.color === 'string' ? data.color.trim() : ''
    if (col && !HEX_COLOR_REGEX.test(col)) {
      errors.color = 'Mã màu không hợp lệ'
    } else {
      result.color = col
    }
  }

  if ('calendarId' in data) {
    result.calendarId = typeof data.calendarId === 'string' && data.calendarId.trim() ? data.calendarId.trim() : null
  }

  if ('isAllDay' in data) {
    result.isAllDay = Boolean(data.isAllDay)
  }

  if ('isCompleted' in data) {
    result.isCompleted = Boolean(data.isCompleted)
  }

  if ('checklist' in data && Array.isArray(data.checklist)) {
    result.checklist = data.checklist
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, idx) => ({
        id: typeof item.id === 'string' ? item.id : `task-${Date.now()}-${idx}`,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        isCompleted: Boolean(item.isCompleted),
      }))
      .filter((item) => item.title.length > 0)
  }

  if ('reminders' in data && Array.isArray(data.reminders)) {
    result.reminders = data.reminders
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
      .map((r) => ({
        method: r.method === 'email' ? ('email' as const) : ('in-app' as const),
        minutesBefore: typeof r.minutesBefore === 'number' && r.minutesBefore >= 0 ? r.minutesBefore : 15,
      }))
  }

  if ('recurrence' in data && data.recurrence && typeof data.recurrence === 'object') {
    const rec = data.recurrence as Record<string, unknown>
    if (!isValidRecurrenceInput(rec, result.startDate)) errors.recurrence = 'Quy tắc lặp lại không hợp lệ. Kiểm tra chu kỳ (1–99), ngày kết thúc và số lần lặp (1–365).'
    const freq = typeof rec.frequency === 'string' && VALID_RECURRENCE.includes(rec.frequency)
      ? (rec.frequency as RecurrenceConfig['frequency'])
      : 'none'
    result.recurrence = {
      frequency: freq,
      interval: typeof rec.interval === 'number' && rec.interval > 0 ? rec.interval : 1,
      daysOfWeek: Array.isArray(rec.daysOfWeek) ? (rec.daysOfWeek as number[]) : [],
      until: typeof rec.until === 'string' ? rec.until : null,
      count: typeof rec.count === 'number' ? rec.count : null,
    }
  }

  if ('timeZone' in data && typeof data.timeZone === 'string') {
    result.timeZone = data.timeZone.trim()
  }

  if ('guests' in data) {
    result.guests = parseGuests(data.guests)
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(400, 'EVENT_VALIDATION_ERROR', 'Thông tin cập nhật không hợp lệ', errors)
  }

  return result
}
