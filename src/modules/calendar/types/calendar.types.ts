export interface CalendarEventPayload {
  title: string
  description?: string
  startDate: string
  endDate: string
  type?: 'class' | 'exam' | 'deadline' | 'personal'
}

