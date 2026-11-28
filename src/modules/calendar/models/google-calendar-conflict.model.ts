import { Schema, model, type InferSchemaType } from 'mongoose'

const conflictRecurrenceSchema = new Schema(
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

const conflictVersionSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isAllDay: { type: Boolean, default: false },
    location: { type: String, default: '' },
    onlineMeetingUrl: { type: String, default: '' },
    availability: { type: String, enum: ['busy', 'free'], default: 'busy' },
    visibility: { type: String, enum: ['default', 'public', 'private'], default: 'default' },
    timeZone: { type: String, default: '' },
    recurrence: {
      type: conflictRecurrenceSchema,
      default: () => ({ frequency: 'none', interval: 1, daysOfWeek: [] }),
    },
    etag: { type: String, default: '' },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
)

const googleCalendarConflictSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    integrationId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleCalendarIntegration',
      default: null,
      index: true,
    },
    calendarConnectionId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleCalendar',
      default: null,
      index: true,
    },
    mappingId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleEventMapping',
      default: null,
      index: true,
    },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    googleEventId: { type: String, required: true },
    baseVersion: { type: conflictVersionSchema, default: undefined },
    localVersion: { type: conflictVersionSchema, required: true },
    googleVersion: { type: conflictVersionSchema, required: true },
    conflictedFields: { type: [String], default: [] },
    fieldChoices: { type: Map, of: String, default: undefined },
    localExpectedUpdatedAt: { type: Date, default: null },
    remoteExpectedEtag: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'resolution_pending', 'resolved_local', 'resolved_google', 'resolved_merged'],
      default: 'pending',
      index: true,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
)

googleCalendarConflictSchema.index({ userId: 1, status: 1 })
googleCalendarConflictSchema.index(
  { userId: 1, eventId: 1, calendarConnectionId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'resolution_pending'] } } },
)
googleCalendarConflictSchema.index(
  { resolvedAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: {
      status: { $in: ['resolved_local', 'resolved_google', 'resolved_merged'] },
    },
  },
)

export type GoogleCalendarConflictDocument = InferSchemaType<typeof googleCalendarConflictSchema>
export const GoogleCalendarConflictModel = model(
  'GoogleCalendarConflict',
  googleCalendarConflictSchema,
)
