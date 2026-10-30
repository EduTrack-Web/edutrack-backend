import { Schema, model } from 'mongoose'

const otpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['registration', 'password-reset', 'login-2fa', 'toggle-2fa'], required: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    attempts: { type: Number, default: 0, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
)

otpSchema.index({ userId: 1, purpose: 1, createdAt: -1 })

export const OtpModel = model('Otp', otpSchema)
