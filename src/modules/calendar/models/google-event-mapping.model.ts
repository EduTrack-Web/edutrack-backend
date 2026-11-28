import { Schema, model, type InferSchemaType } from 'mongoose'

const snapshotRecurrenceSchema = new Schema(
  {
    frequency: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'custom'],
      default: 'none',
    },
    interval: { type: Number, default: 1 },
    daysOfWeek: { type: [Number], default: [] },
    until: { type: Date, default: null },
    count: { type: Number, default: null },
  },
  { _id: false },
)

const eventBaseSnapshotSchema = new Schema(
  {
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isAllDay: { type: Boolean, default: false },
    location: { type: String, default: '' },
    onlineMeetingUrl: { type: String, default: '' },
    availability: { type: String, enum: ['busy', 'free'], default: 'busy' },
    visibility: { type: String, enum: ['default', 'public', 'private'], default: 'default' },
    timeZone: { type: String, default: '' },
    recurrence: { type: snapshotRecurrenceSchema, default: () => ({ frequency: 'none', interval: 1, daysOfWeek: [] }) },
    exceptionDates: { type: [Date], default: [] },
  },
  { _id: false },
)

const googleEventMappingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    integrationId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleCalendarIntegration',
      required: true,
      index: true,
    },
    calendarConnectionId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleCalendar',
      required: true,
      index: true,
    },
    eduTrackEventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    googleCalendarId: { type: String, required: true },
    googleEventId: { type: String, required: true },
    googleRecurringEventId: { type: String, default: '' },
    originalStartTime: { type: Date, default: null },
    etag: { type: String, default: '' },
    accessRole: {
      type: String,
      enum: ['freeBusyReader', 'reader', 'writer', 'owner'],
      default: 'writer',
    },
    canEdit: { type: Boolean, default: true },
    organizerEmail: { type: String, default: '' },
    creatorEmail: { type: String, default: '' },
    status: {
      type: String,
      enum: [
        'synced',
        'pending_push',
        'pending_delete',
        'conflict_pending',
        'resolution_pending',
        'suppressed_local_delete',
      ],
      default: 'synced',
      index: true,
    },
    lastSyncedAt: { type: Date, default: null },
    remoteUpdatedAt: { type: Date, default: null },
    localSyncedVersionAt: { type: Date, default: null },
    baseSnapshot: { type: eventBaseSnapshotSchema, default: undefined },
    idempotencyKey: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
)

googleEventMappingSchema.index({ calendarConnectionId: 1, googleEventId: 1 }, { unique: true })
googleEventMappingSchema.index({ eduTrackEventId: 1, calendarConnectionId: 1 }, { unique: true })
googleEventMappingSchema.index({ calendarConnectionId: 1, googleRecurringEventId: 1, originalStartTime: 1 })
googleEventMappingSchema.index({ userId: 1, integrationId: 1, status: 1 })

export type GoogleEventMappingDocument = InferSchemaType<typeof googleEventMappingSchema>
export const GoogleEventMappingModel = model('GoogleEventMapping', googleEventMappingSchema)
