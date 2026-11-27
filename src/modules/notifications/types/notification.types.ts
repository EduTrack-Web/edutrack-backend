export type NotificationType =
  | 'event_invitation'
  | 'event_reminder'
  | 'event_update'
  | 'event_response'
  | 'calendar_shared'
  | 'event_join_request'
  | 'event_join_response'
  | 'system'

export interface NotificationResponse {
  id: string
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
  isRead: boolean
  eventId?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  message: string
  link?: string
  eventId?: string | null
  metadata?: Record<string, unknown>
}
