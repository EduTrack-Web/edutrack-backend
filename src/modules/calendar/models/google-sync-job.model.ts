import { Schema, model, type InferSchemaType } from 'mongoose'

const attemptHistorySchema = new Schema(
  {
    attemptNumber: { type: Number, required: true },
    triggerType: { type: String, enum: ['auto', 'manual'], required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    errorCode: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    retryAfterMs: { type: Number, default: null },
  },
  { _id: false },
)

const googleSyncJobSchema = new Schema(
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
      default: null,
      index: true,
    },
    mappingId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleEventMapping',
      default: null,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    conflictId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleCalendarConflict',
      default: null,
    },
    jobType: {
      type: String,
      enum: ['full_sync', 'incremental_sync', 'event_push', 'event_delete', 'conflict_resolve'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'retry_wait', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    idempotencyKey: { type: String, default: '' },
    retriesUsed: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 5 },
    nextRetryAt: { type: Date, default: Date.now, index: true },
    checkpoint: {
      nextPageToken: { type: String, default: '' },
      processedCount: { type: Number, default: 0 },
      pendingSyncToken: { type: String, default: '' },
    },
    leaseOwner: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: '' },
    lastErrorMessage: { type: String, default: '' },
    completedAt: { type: Date, default: null },
    attemptHistory: { type: [attemptHistorySchema], default: [] },
  },
  { timestamps: true, versionKey: false },
)

googleSyncJobSchema.index({ status: 1, nextRetryAt: 1, leaseExpiresAt: 1 })
googleSyncJobSchema.index(
  { calendarConnectionId: 1, jobType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      calendarConnectionId: { $type: 'objectId' },
      jobType: { $in: ['full_sync', 'incremental_sync'] },
      status: { $in: ['pending', 'running', 'retry_wait'] },
    },
  },
)
googleSyncJobSchema.index(
  { mappingId: 1, jobType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      mappingId: { $type: 'objectId' },
      jobType: { $in: ['event_push', 'event_delete', 'conflict_resolve'] },
      status: { $in: ['pending', 'running', 'retry_wait'] },
    },
  },
)
googleSyncJobSchema.index(
  { completedAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { status: { $in: ['completed', 'cancelled'] } },
  },
)

export type GoogleSyncJobDocument = InferSchemaType<typeof googleSyncJobSchema>
export const GoogleSyncJobModel = model('GoogleSyncJob', googleSyncJobSchema)
