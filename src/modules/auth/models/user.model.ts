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
    status: { type: String, enum: ['pending', 'active', 'locked'], default: 'pending', required: true },
    emailVerified: { type: Boolean, default: false, required: true },
    twoFactorEnabled: { type: Boolean, default: false, required: true },
    failedLoginAttempts: { type: Number, default: 0, required: true, select: false },
    lockUntil: { type: Date, select: false },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
)

export type UserDocument = InferSchemaType<typeof userSchema>
export const UserModel = model('User', userSchema)
