import { OtpModel } from '../../auth/models/otp.model.js'
import { SessionModel } from '../../auth/models/session.model.js'
import { UserModel } from '../../auth/models/user.model.js'

export const accountRepository = {
  findById: (userId: string) => UserModel.findById(userId),

  findUserWithPassword: (userId: string) => UserModel.findById(userId).select('+passwordHash'),

  findUserWithSecrets: (userId: string) => UserModel.findById(userId).select('+passwordHash +googleId'),

  findByUsername: (username: string) =>
    UserModel.findOne({ username: username.toLowerCase() }),

  findByGoogleId: (googleId: string) =>
    UserModel.findOne({ googleId }).select('+googleId'),

  updateUser: (userId: string, updates: Record<string, unknown>) =>
    UserModel.findByIdAndUpdate(userId, { $set: updates }, { new: true, runValidators: true }),

  unlinkGoogle: (userId: string) =>
    UserModel.findByIdAndUpdate(userId, { $unset: { googleId: 1 } }, { new: true }),

  linkGoogle: (userId: string, googleId: string) =>
    UserModel.findByIdAndUpdate(userId, { $set: { googleId } }, { new: true }),

  findActiveSessions: (userId: string) =>
    SessionModel.find({
      userId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    })
      .sort({ lastUsedAt: -1 })
      .select('+tokenHash')
      .lean(),

  revokeOtherSessions: (userId: string, currentTokenHash?: string) => {
    const filter = currentTokenHash
      ? { userId, revokedAt: { $exists: false }, tokenHash: { $ne: currentTokenHash } }
      : { userId, revokedAt: { $exists: false } }
    return SessionModel.updateMany(filter, { $set: { revokedAt: new Date() } })
  },

  deleteUserAndData: async (userId: string) => {
    await Promise.all([
      UserModel.findByIdAndDelete(userId),
      SessionModel.deleteMany({ userId }),
      OtpModel.deleteMany({ userId }),
    ])
  },
}
