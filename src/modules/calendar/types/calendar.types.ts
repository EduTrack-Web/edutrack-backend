export type EntryType = 'event' | 'task'
export type EventPriority = 'low' | 'medium' | 'high' | 'urgent'
export type EventAvailability = 'busy' | 'free'
export type EventVisibility = 'default' | 'public' | 'private'
export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom'
export type ReminderMethod = 'in-app' | 'email'

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

export interface CalendarCategoryResponse {
  id: string
  userId: string
  name: string
  color: string
  description: string
  isVisible: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateCategoryInput {
  name: string
  color?: string
  description?: string
}

export interface UpdateCategoryInput {
  name?: string
  color?: string
  description?: string
  isVisible?: boolean
}

export interface CalendarEventResponse {
  id: string
  userId: string
  calendarId?: string | null
  calendar?: CalendarCategoryResponse | null
  entryType: EntryType
  title: string
  description: string
  priority: EventPriority
  startDate: string
  endDate: string
  isAllDay: boolean
  location: string
  onlineMeetingUrl: string
  submissionUrl: string
  color: string
  availability: EventAvailability
  visibility: EventVisibility
  isCompleted: boolean
  completedAt?: string | null
  checklist: SubtaskItem[]
  reminders: ReminderItem[]
  recurrence?: RecurrenceConfig
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
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: EventAvailability
  visibility?: EventVisibility
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: RecurrenceConfig
}

export interface UpdateEventInput {
  calendarId?: string | null
  entryType?: EntryType
  title?: string
  description?: string
  priority?: EventPriority
  startDate?: string
  endDate?: string
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: EventAvailability
  visibility?: EventVisibility
  isCompleted?: boolean
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: RecurrenceConfig
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
