export type EntryType = 'event' | 'task'
export type EventPriority = 'low' | 'medium' | 'high' | 'urgent'
export type EventAvailability = 'busy' | 'free'
export type EventVisibility = 'default' | 'public' | 'private'
export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom'
export type RecurringUpdateMode = 'this' | 'following' | 'all' | 'all_this_weekday'
export type ReminderMethod = 'in-app' | 'email'

export interface EventGuest {
  email: string
  role?: 'viewer' | 'editor'
  canModify?: boolean
  canInviteOthers?: boolean
  canSeeGuestList?: boolean
  status?: 'pending' | 'accepted' | 'declined'
}

export interface CategoryMember {
  email: string
  role: 'viewer' | 'editor' | 'admin'
}

export interface SubtaskItem {
  id: string
  title: string
  isCompleted: boolean
}

export interface ReminderItem {
  method: ReminderMethod
  minutesBefore: number
}

export interface RecurrenceConfig {
  frequency: RecurrenceFrequency
  interval: number
  daysOfWeek?: number[]
  until?: string | null
  count?: number | null
}

export interface CalendarSettings {
  timeZone: string
  weekStartsOn?: 0 | 1
  workingHoursStart?: string
  workingHoursEnd?: string
  defaultDurationMinutes: number
  reminders: ReminderItem[]
  privacy?: 'private' | 'public'
  archived: boolean
  sharedWith?: CategoryMember[]
}

export interface CalendarCategoryResponse {
  settings?: CalendarSettings
  id: string
  userId: string
  name: string
  color: string
  description: string
  isVisible: boolean
  isDefault: boolean
  sharedWith?: CategoryMember[]
  createdAt: string
  updatedAt: string
}

export interface CreateCategoryInput {
  settings?: CalendarSettings
  name: string
  color?: string
  description?: string
  sharedWith?: CategoryMember[]
}

export interface UpdateCategoryInput {
  settings?: CalendarSettings
  name?: string
  color?: string
  description?: string
  isVisible?: boolean
  sharedWith?: CategoryMember[]
}

export interface CalendarEventResponse {
  id: string
  userId: string
  creator?: { id: string; email: string; fullName: string }
  creatorEmail?: string
  calendarId?: string | null
  calendar?: CalendarCategoryResponse | null
  entryType: EntryType
  title: string
  description: string
  priority: EventPriority
  startDate: string
  endDate: string
  deadline?: string | null
  isAllDay: boolean
  location: string
  onlineMeetingUrl: string
  submissionUrl: string
  color: string
  inheritsCalendarColor: boolean
  availability: EventAvailability
  visibility: EventVisibility
  timeZone?: string
  guests?: EventGuest[]
  isCompleted: boolean
  completedAt?: string | null
  checklist: SubtaskItem[]
  reminders: ReminderItem[]
  recurrence?: RecurrenceConfig
  exceptionDates?: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateEventInput {
  calendarId?: string | null
  entryType: EntryType
  title: string
  description?: string
  priority?: EventPriority
  startDate: string
  endDate: string
  deadline?: string | null
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: EventAvailability
  visibility?: EventVisibility
  timeZone?: string
  guests?: EventGuest[]
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: RecurrenceConfig
  mode?: RecurringUpdateMode
  targetDate?: string
}

export interface UpdateEventInput {
  calendarId?: string | null
  entryType?: EntryType
  title?: string
  description?: string
  priority?: EventPriority
  startDate?: string
  endDate?: string
  deadline?: string | null
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: EventAvailability
  visibility?: EventVisibility
  timeZone?: string
  guests?: EventGuest[]
  isCompleted?: boolean
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: RecurrenceConfig
  mode?: 'this' | 'following' | 'all'
  targetDate?: string
  exceptionDates?: string[] | Date[]
}

export interface EventQueryFilters {
  from?: string
  to?: string
  entryType?: EntryType
  calendarId?: string
  calendarIds?: string[]
  isCompleted?: boolean
  q?: string
}

export interface CalendarPreferences {
  showLunarCalendar: boolean
}

export interface VietnameseLunarDate {
  solarDate: string
  lunarDay: number
  lunarMonth: number
  lunarYear: number
  isLeapMonth: boolean
  alternateLunar?: {
    label: string
    lunarDay: number
    lunarMonth: number
    lunarYear: number
    isLeapMonth: boolean
  }
}

export interface DateOnlyParts {
  year: number
  month: number
  day: number
}
