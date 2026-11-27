import { Schema, model, type InferSchemaType } from 'mongoose'

const calendarCategorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    color: {
      type: String,
      required: true,
      trim: true,
      default: '#2563EB',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    settings: {
      type: new Schema({
        timeZone: { type: String, required: true },
        weekStartsOn: { type: Number, default: 0 },
        workingHoursStart: { type: String, default: '08:00' },
        workingHoursEnd: { type: String, default: '17:00' },
        defaultDurationMinutes: { type: Number, required: true },
        reminders: { type: [{ _id: false, method: String, minutesBefore: Number }], default: [] },
        privacy: { type: String, enum: ['private', 'public'], default: 'private' },
        archived: { type: Boolean, default: false },
        sharedWith: {
          type: [
            new Schema({
              email: { type: String, required: true, trim: true, lowercase: true },
              role: { type: String, enum: ['viewer', 'editor', 'admin'], default: 'viewer' },
            }, { _id: false })
          ],
          default: [],
        },
      }, { _id: false }),
      default: undefined,
    },
    sharedWith: {
      type: [
        new Schema({
          email: { type: String, required: true, trim: true, lowercase: true },
          role: { type: String, enum: ['viewer', 'editor', 'admin'], default: 'viewer' },
        }, { _id: false })
      ],
      default: [],
    },
    isVisible: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    publicToken: {
      type: String,
      default: null,
      index: true,
    },
    subscribers: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
      index: true,
    },
  },
  { timestamps: true, versionKey: false },
)

calendarCategorySchema.index({ userId: 1, name: 1 }, { unique: true })
calendarCategorySchema.index({ userId: 1, createdAt: 1 })

export type CalendarCategoryDocument = InferSchemaType<typeof calendarCategorySchema>
export const CalendarCategoryModel = model('CalendarCategory', calendarCategorySchema)

