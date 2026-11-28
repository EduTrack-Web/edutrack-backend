import { Schema, model, type InferSchemaType } from 'mongoose'

const googleCalendarIntegrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    googleSub: { type: String, required: true, trim: true },
    googleEmail: { type: String, required: true, trim: true, lowercase: true },
    displayName: { type: String, trim: true, default: '' },
    avatarUrl: { type: String, trim: true, default: '' },
    encryptedAccessToken: { type: String, default: '', select: false },
    encryptedRefreshToken: { type: String, default: '', select: false },
    tokenExpiresAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['connected', 'reconnect_required'],
      default: 'connected',
    },
    isPrimarySyncAccount: { type: Boolean, default: false },
    syncToGoogleEnabled: { type: Boolean, default: false },
    syncFromGoogleEnabled: { type: Boolean, default: true },
    lastSyncedAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false },
)

googleCalendarIntegrationSchema.index({ userId: 1, googleSub: 1 }, { unique: true })
googleCalendarIntegrationSchema.index({ userId: 1, isPrimarySyncAccount: -1, createdAt: 1 })
googleCalendarIntegrationSchema.index({ status: 1, syncFromGoogleEnabled: 1 })

export type GoogleCalendarIntegrationDocument = InferSchemaType<typeof googleCalendarIntegrationSchema>
export const GoogleCalendarIntegrationModel = model(
  'GoogleCalendarIntegration',
  googleCalendarIntegrationSchema,
)
