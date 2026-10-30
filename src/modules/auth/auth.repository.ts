import { OtpModel } from './otp.model.js'
import { SessionModel } from './session.model.js'
import { UserModel } from './user.model.js'
import type { OtpPurpose } from './auth.types.js'

export const authRepository = {
  findUserByEmail: (email: string, includeSecrets = false) =>
    UserModel.findOne({ email }).select(includeSecrets ? '+passwordHash +failedLoginAttempts +lockUntil +googleId' : ''),

  findUserByIdentifier: (identifier: string) =>
    UserModel.findOne({ $or: [{ email: identifier }, { username: identifier }] }).select(
      '+passwordHash +failedLoginAttempts +lockUntil +googleId',
    ),

  findUserByGoogleId: (googleId: string) => UserModel.findOne({ googleId }).select('+googleId'),

  usernameExists: (username: string) => UserModel.exists({ username }),

  createUser: (data: Record<string, unknown>) => UserModel.create(data),

  invalidateOtps: (userId: string, purpose: OtpPurpose) =>
    OtpModel.updateMany({ userId, purpose, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } }),

  latestOtp: (userId: string, purpose: OtpPurpose) =>
    OtpModel.findOne({ userId, purpose }).sort({ createdAt: -1 }).select('+codeHash'),

  countRecentOtps: (userId: string, purpose: OtpPurpose, since: Date) =>
    OtpModel.countDocuments({ userId, purpose, createdAt: { $gte: since } }),

  createOtp: (data: { userId: string; purpose: OtpPurpose; codeHash: string; expiresAt: Date }) =>
    OtpModel.create(data),

  findOtpById: (id: string) => OtpModel.findById(id).select('+codeHash'),

  createSession: (data: Record<string, unknown>) => SessionModel.create(data),

  findSessionByHash: (tokenHash: string) => SessionModel.findOne({ tokenHash }).select('+tokenHash'),

  revokeSessionByHash: (tokenHash: string) =>
    SessionModel.updateOne({ tokenHash, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } }),

  revokeOtherSessions: (userId: string, currentSessionId?: string) => {
    const filter = currentSessionId
      ? { userId, revokedAt: { $exists: false }, _id: { $ne: currentSessionId } }
      : { userId, revokedAt: { $exists: false } }
    return SessionModel.updateMany(filter, { $set: { revokedAt: new Date() } })
  },
}
