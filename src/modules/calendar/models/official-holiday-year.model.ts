import { Schema, model, type InferSchemaType } from 'mongoose'

const officialHolidaySourceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    referenceUrl: { type: String, trim: true, maxlength: 500 },
    verifiedBy: { type: String, trim: true, maxlength: 120 },
    verifiedAt: { type: Date },
  },
  { _id: false },
)

const officialHolidayEntrySchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    solarDate: { type: String, required: true, trim: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    calendarType: { type: String, enum: ['solar', 'lunar', 'compensatory'], required: true },
    isDayOff: { type: Boolean, required: true, default: true },
    replacesRuleKey: { type: String, trim: true, maxlength: 80 },
    lunarDateLabel: { type: String, trim: true, maxlength: 80 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
)

const officialHolidayVersionSnapshotSchema = new Schema(
  {
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['draft', 'confirmed', 'archived'], required: true },
    source: { type: officialHolidaySourceSchema, required: true },
    holidays: { type: [officialHolidayEntrySchema], required: true, default: [] },
    archivedAt: { type: Date, required: true },
  },
  { _id: false },
)

const officialHolidayYearSchema = new Schema(
  {
    year: { type: Number, required: true, unique: true, min: 1900, max: 2199 },
    status: { type: String, enum: ['draft', 'confirmed', 'archived'], default: 'draft', required: true },
    source: { type: officialHolidaySourceSchema, required: true },
    version: { type: Number, required: true, min: 1, default: 1 },
    holidays: { type: [officialHolidayEntrySchema], required: true, default: [] },
    previousVersions: { type: [officialHolidayVersionSnapshotSchema], required: true, default: [] },
  },
  {
    collection: 'official_holiday_years',
    timestamps: true,
  },
)

officialHolidayYearSchema.index({ year: 1, status: 1, version: 1 })

export type OfficialHolidayYearDocument = InferSchemaType<typeof officialHolidayYearSchema>
export const OfficialHolidayYearModel = model('OfficialHolidayYear', officialHolidayYearSchema)
