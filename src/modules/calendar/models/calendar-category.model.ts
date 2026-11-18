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
    isVisible: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true, versionKey: false },
)

calendarCategorySchema.index({ userId: 1, name: 1 }, { unique: true })
calendarCategorySchema.index({ userId: 1, createdAt: 1 })

export type CalendarCategoryDocument = InferSchemaType<typeof calendarCategorySchema>
export const CalendarCategoryModel = model('CalendarCategory', calendarCategorySchema)

