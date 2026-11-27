import { Schema, model, type InferSchemaType } from 'mongoose'

const subtaskSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    isCompleted: { type: Boolean, default: false },
  },
  { _id: false },
)

const reminderSchema = new Schema(
  {
    method: { type: String, enum: ['in-app', 'email'], default: 'in-app' },
    minutesBefore: { type: Number, required: true, default: 15 },
  },
  { _id: false },
)

const eventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    calendarId: { type: Schema.Types.ObjectId, ref: 'CalendarCategory', default: null, index: true },
    entryType: {
      type: String,
      enum: ['event', 'task'],
      required: true,
      default: 'event',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      required: true,
      default: 'medium',
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    deadline: {
      type: Date,
      default: null,
    },
    isAllDay: {
      type: Boolean,
      default: false,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    onlineMeetingUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    submissionUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    color: {
      type: String,
      trim: true,
      default: '',
    },
    availability: {
      type: String,
      enum: ['busy', 'free'],
      default: 'busy',
    },
    visibility: {
      type: String,
      enum: ['default', 'public', 'private'],
      default: 'default',
    },
    timeZone: {
      type: String,
      trim: true,
      default: '',
    },
    guests: {
      type: [
        new Schema({
          email: { type: String, required: true, trim: true, lowercase: true },
          role: { type: String, enum: ['viewer', 'editor'], default: 'viewer' },
          canModify: { type: Boolean, default: false },
          canInviteOthers: { type: Boolean, default: true },
          canSeeGuestList: { type: Boolean, default: true },
          status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
        }, { _id: false })
      ],
      default: [],
    },
    isCompleted: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    checklist: {
      type: [subtaskSchema],
      default: [],
    },
    reminders: {
      type: [reminderSchema],
      default: [{ method: 'in-app', minutesBefore: 15 }],
    },
    recurrence: {
      frequency: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'custom'],
        default: 'none',
      },
      interval: {
        type: Number,
        min: 1,
        default: 1,
      },
      daysOfWeek: {
        type: [Number],
        default: [],
      },
      until: {
        type: Date,
        default: null,
      },
      count: {
        type: Number,
        default: null,
      },
    },
    exceptionDates: {
      type: [Date],
      default: [],
    },
    recurringEventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    originalStartDate: {
      type: Date,
      default: null,
    },
    remindersSent: {
      type: [
        new Schema(
          {
            reminderKey: { type: String, required: true },
            sentAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    shareToken: {
      type: String,
      default: null,
      index: true,
    },
    isShareEnabled: {
      type: Boolean,
      default: false,
    },
    joinRequests: {
      type: [
        new Schema(
          {
            userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            email: { type: String, required: true, trim: true, lowercase: true },
            fullName: { type: String, trim: true, default: '' },
            message: { type: String, trim: true, maxlength: 300, default: '' },
            status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
            createdAt: { type: Date, default: Date.now },
            respondedAt: { type: Date, default: null },
          },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, versionKey: false },
)

eventSchema.index({ userId: 1, startDate: 1, endDate: 1 })
eventSchema.index({ userId: 1, entryType: 1, isCompleted: 1 })
eventSchema.index({ userId: 1, calendarId: 1 })
eventSchema.index({ 'guests.email': 1 })

export type EventDocument = InferSchemaType<typeof eventSchema>
export const EventModel = model('Event', eventSchema)
