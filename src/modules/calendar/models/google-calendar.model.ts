import { Schema, model, type InferSchemaType } from 'mongoose'

const fullSyncCheckpointSchema = new Schema(
  {
    nextPageToken: { type: String, default: '' },
    syncedCount: { type: Number, default: 0 },
    pagesProcessed: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: false },
)

const watchChannelSchema = new Schema(
  {
    channelId: { type: String, default: '' },
    resourceId: { type: String, default: '' },
    tokenHash: { type: String, default: '' },
    expiration: { type: Date, default: null },
  },
  { _id: false },
)

const googleCalendarSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    integrationId: {
      type: Schema.Types.ObjectId,
      ref: 'GoogleCalendarIntegration',
      required: true,
      index: true,
    },
    googleCalendarId: { type: String, required: true, trim: true },
    summary: { type: String, trim: true, default: '' },
    description: { type: String, default: '' },
    backgroundColor: { type: String, trim: true, default: '#2563EB' },
    foregroundColor: { type: String, trim: true, default: '#FFFFFF' },
    timeZone: { type: String, trim: true, default: 'Asia/Ho_Chi_Minh' },
    accessRole: {
      type: String,
      enum: ['freeBusyReader', 'reader', 'writer', 'owner'],
      default: 'reader',
    },
    isPrimary: { type: Boolean, default: false },
    isSelected: { type: Boolean, default: false },
    isVisible: { type: Boolean, default: true },
    syncStatus: {
      type: String,
      enum: [
        'unselected',
        'initial_sync_pending',
        'initial_sync_running',
        'initial_sync_failed',
        'active',
        'error',
      ],
      default: 'unselected',
    },
    fullSyncCheckpoint: {
      type: fullSyncCheckpointSchema,
      default: () => ({ syncedCount: 0, pagesProcessed: 0 }),
    },
    watchChannel: {
      type: watchChannelSchema,
      default: () => ({ channelId: '', resourceId: '', tokenHash: '', expiration: null }),
    },
    syncToken: { type: String, default: '' },
    lastSyncedAt: { type: Date, default: null },
    nextSyncAt: { type: Date, default: null },
    lastSyncError: { type: String, default: '' },
    lastSyncErrorCode: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
)

googleCalendarSchema.index({ integrationId: 1, googleCalendarId: 1 }, { unique: true })
googleCalendarSchema.index({ userId: 1, integrationId: 1, isSelected: 1 })
googleCalendarSchema.index({ isSelected: 1, syncStatus: 1, nextSyncAt: 1 })
googleCalendarSchema.index(
  { 'watchChannel.channelId': 1 },
  { partialFilterExpression: { 'watchChannel.channelId': { $gt: '' } } },
)

export type GoogleCalendarDocument = InferSchemaType<typeof googleCalendarSchema>
export const GoogleCalendarModel = model('GoogleCalendar', googleCalendarSchema)
