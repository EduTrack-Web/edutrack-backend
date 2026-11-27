import { Schema, model, type InferSchemaType } from 'mongoose'

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 40 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, select: false },
    avatarUrl: { type: String },
    phone: { type: String },
    googleId: { type: String, unique: true, sparse: true, select: false },
    role: { type: String, enum: ['user', 'admin'], default: 'user', required: true },
    userType: { type: String, enum: ['student', 'pupil', 'worker', 'teacher', 'other'], default: 'student' },
    organization: { type: String, trim: true, maxlength: 100 },
    fieldOfStudy: { type: String, trim: true, maxlength: 100 },
    profileCompleted: { type: Boolean, default: false, required: true },
    status: { type: String, enum: ['pending', 'active', 'locked'], default: 'pending', required: true },
    emailVerified: { type: Boolean, default: false, required: true },
    twoFactorEnabled: { type: Boolean, default: false, required: true },
    failedLoginAttempts: { type: Number, default: 0, required: true, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
    lastActiveAt: { type: Date },
    lastUsernameChangedAt: { type: Date },
    preferences: {
      calendar: {
        showLunarCalendar: { type: Boolean, default: false, required: true },
        showVietnameseHolidays: { type: Boolean, default: true, required: true },
        showPublicHolidays: { type: Boolean, default: true, required: true },
        showObservanceHolidays: { type: Boolean, default: true, required: true },
        defaultCalendarInitialized: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true },
)

export type UserDocument = InferSchemaType<typeof userSchema>
export const UserModel = model('User', userSchema)
