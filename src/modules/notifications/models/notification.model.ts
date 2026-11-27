import { Schema, model, type InferSchemaType } from 'mongoose'

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['event_invitation', 'event_reminder', 'event_update', 'event_response', 'calendar_shared', 'event_join_request', 'event_join_response', 'system'],
      default: 'system',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    link: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true, versionKey: false },
)

notificationSchema.index({ userId: 1, createdAt: -1 })
notificationSchema.index({ userId: 1, isRead: 1 })

export type NotificationDocument = InferSchemaType<typeof notificationSchema>
export const NotificationModel = model('Notification', notificationSchema)
