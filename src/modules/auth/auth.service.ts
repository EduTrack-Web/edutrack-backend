import { randomInt } from 'node:crypto'

import bcrypt from 'bcrypt'

import { AppError } from '../../shared/errors/app-error.js'
import { authRepository } from './auth.repository.js'
import type { OtpPurpose, SafeUser } from './auth.types.js'
import { sendOtpEmail } from './email.service.js'
import { createAccessToken, createRefreshToken, hashToken, refreshMaxAge } from './token.service.js'
import { emailError, normalizeEmail, normalizeIdentifier, passwordError, validateEmail, validatePassword } from './auth.validation.js'

const OTP_EXPIRY_MS = 10 * 60 * 1000
const OTP_RESEND_DELAY_MS = 10 * 1000
const OTP_WINDOW_MS = 60 * 60 * 1000
const MAX_OTP_PER_WINDOW = 15
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000

const toSafeUser = (user: {
  _id: unknown; fullName: string; username: string; email: string; avatarUrl?: string | null; phone?: string | null
  role: string; status: string; emailVerified: boolean; twoFactorEnabled: boolean
}): SafeUser => ({
  id: String(user._id),
  fullName: user.fullName,
  username: user.username,
  email: user.email,
  ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
  ...(user.phone ? { phone: user.phone } : {}),
  role: user.role as SafeUser['role'],
  status: user.status as SafeUser['status'],
  emailVerified: user.emailVerified,
  twoFactorEnabled: user.twoFactorEnabled,
})

const createUsername = async (fullName: string): Promise<string> => {
  const base = fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'user'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = `${base}-${randomInt(1000, 10_000)}`
    if (!(await authRepository.usernameExists(username))) return username
  }
  throw new AppError(503, 'USERNAME_GENERATION_FAILED', 'Không thể tạo username lúc này.')
}

const issueOtp = async (userId: string, email: string, purpose: OtpPurpose): Promise<string> => {
  const latest = await authRepository.latestOtp(userId, purpose)
  if (latest && Date.now() - latest.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
    throw new AppError(429, 'OTP_RESEND_TOO_SOON', 'Vui lòng chờ 10 giây trước khi gửi lại OTP.')
  }
  const recentCount = await authRepository.countRecentOtps(userId, purpose, new Date(Date.now() - OTP_WINDOW_MS))
  if (recentCount >= MAX_OTP_PER_WINDOW) {
    throw new AppError(429, 'OTP_RATE_LIMITED', 'Bạn đã yêu cầu quá nhiều mã OTP. Vui lòng thử lại sau.')
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await authRepository.invalidateOtps(userId, purpose)
  const otp = await authRepository.createOtp({
    userId,
    purpose,
    codeHash: await bcrypt.hash(code, 10),
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
  })
  await sendOtpEmail(email, code, purpose)
  return String(otp._id)
}

const verifyOtp = async (otpId: string, code: string, purpose: OtpPurpose) => {
  const otp = await authRepository.findOtpById(otpId)
  if (!otp || otp.purpose !== purpose || otp.usedAt) throw new AppError(400, 'OTP_INVALID', 'Mã OTP không hợp lệ.')
  if (otp.expiresAt.getTime() < Date.now()) throw new AppError(400, 'OTP_EXPIRED', 'Mã OTP đã hết hạn.')
  if (otp.attempts >= 5) throw new AppError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Mã OTP đã bị vô hiệu hóa.')
  const matches = await bcrypt.compare(code, otp.codeHash)
  if (!matches) {
    otp.attempts += 1
    await otp.save()
    throw new AppError(400, 'OTP_INCORRECT', 'Mã OTP không đúng.')
  }
  otp.usedAt = new Date()
  await otp.save()
  return otp
}

const createSession = async (user: { _id: unknown; role: string }, context: { userAgent?: string; ipAddress?: string }) => {
  const refreshToken = createRefreshToken()
  const session = await authRepository.createSession({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + refreshMaxAge),
    lastUsedAt: new Date(),
    ...context,
  })
  return { accessToken: createAccessToken(String(user._id), user.role), refreshToken, sessionId: String(session._id) }
}

export const authService = {
  async register(input: { fullName: string; email: string; password: string; confirmPassword: string }) {
    const email = normalizeEmail(input.email)
    const fieldErrors: Record<string, string> = {}
    const invalidEmail = emailError(email)
    const invalidPassword = passwordError(input.password)
    if (invalidEmail) fieldErrors.email = invalidEmail
    if (invalidPassword) fieldErrors.password = invalidPassword
    if (input.password !== input.confirmPassword) fieldErrors.confirmPassword = 'Mật khẩu xác nhận không khớp.'
    if (input.fullName.trim().length < 2 || input.fullName.trim().length > 50) fieldErrors.fullName = 'Họ và tên phải dài từ 2 đến 50 ký tự.'
    if (Object.keys(fieldErrors).length > 0) throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', fieldErrors)
    if (await authRepository.findUserByEmail(email)) throw new AppError(409, 'EMAIL_EXISTS', 'Email đã được sử dụng.', { email: 'Email đã được sử dụng.' })

    const user = await authRepository.createUser({
      fullName: input.fullName.trim(), email, username: await createUsername(input.fullName),
      passwordHash: await bcrypt.hash(input.password, 12), role: 'user', status: 'pending', emailVerified: false,
    })
    return { user: toSafeUser(user), otpId: await issueOtp(String(user._id), email, 'registration') }
  },

  async verifyRegistration(otpId: string, code: string) {
    const otp = await verifyOtp(otpId, code, 'registration')
    const { UserModel } = await import('./user.model.js')
    const updated = await UserModel.findByIdAndUpdate(otp.userId, { status: 'active', emailVerified: true }, { new: true })
    if (!updated) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    return toSafeUser(updated)
  },

  async login(identifierInput: string, password: string, context: { userAgent?: string; ipAddress?: string }) {
    const identifier = normalizeIdentifier(identifierInput)
    const user = await authRepository.findUserByIdentifier(identifier)
    if (!user?.passwordHash) throw new AppError(401, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập không chính xác.')
    if (user.status === 'locked') throw new AppError(423, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa.')
    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) throw new AppError(429, 'LOGIN_TEMPORARILY_LOCKED', 'Tài khoản tạm khóa đăng nhập. Vui lòng thử lại sau.')

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      user.failedLoginAttempts += 1
      if (user.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOGIN_LOCK_MS)
        user.failedLoginAttempts = 0
      }
      await user.save()
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập không chính xác.')
    }

    user.failedLoginAttempts = 0
    user.lockUntil = undefined
    if (user.status === 'pending') {
      await user.save()
      return { requiresVerification: true as const, otpId: await issueOtp(String(user._id), user.email, 'registration') }
    }
    if (user.twoFactorEnabled) {
      await user.save()
      return { requiresTwoFactor: true as const, otpId: await issueOtp(String(user._id), user.email, 'login-2fa') }
    }
    user.lastLoginAt = new Date()
    await user.save()
    return { user: toSafeUser(user), tokens: await createSession(user, context) }
  },

  async verifyTwoFactor(otpId: string, code: string, context: { userAgent?: string; ipAddress?: string }) {
    const otp = await verifyOtp(otpId, code, 'login-2fa')
    const { UserModel } = await import('./user.model.js')
    const user = await UserModel.findById(otp.userId)
    if (!user || user.status !== 'active') throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Tài khoản không khả dụng.')
    user.lastLoginAt = new Date()
    await user.save()
    return { user: toSafeUser(user), tokens: await createSession(user, context) }
  },

  async forgotPassword(emailInput: string) {
    const email = normalizeEmail(emailInput)
    validateEmail(email)
    const user = await authRepository.findUserByEmail(email)
    if (!user) throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email không tồn tại trong hệ thống.', { email: 'Email không tồn tại trong hệ thống.' })
    if (user.status === 'locked') throw new AppError(423, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa.')
    if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Tài khoản chưa được kích hoạt.')
    return { accepted: true as const, otpId: await issueOtp(String(user._id), email, 'password-reset') }
  },

  async resendOtp(otpId: string, purpose: OtpPurpose) {
    const previous = await authRepository.findOtpById(otpId)
    if (!previous || previous.purpose !== purpose) throw new AppError(400, 'OTP_INVALID', 'Yêu cầu gửi lại OTP không hợp lệ.')
    const { UserModel } = await import('./user.model.js')
    const user = await UserModel.findById(previous.userId)
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    return { otpId: await issueOtp(String(user._id), user.email, purpose) }
  },

  async resetPassword(otpId: string, code: string, password: string, confirmPassword: string) {
    validatePassword(password, 'newPassword')
    if (password !== confirmPassword) throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { confirmPassword: 'Mật khẩu xác nhận không khớp.' })
    const otp = await verifyOtp(otpId, code, 'password-reset')
    const { UserModel } = await import('./user.model.js')
    const user = await UserModel.findById(otp.userId).select('+passwordHash')
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    if (user.passwordHash && await bcrypt.compare(password, user.passwordHash)) throw new AppError(422, 'PASSWORD_REUSED', 'Mật khẩu mới phải khác mật khẩu cũ.')
    user.passwordHash = await bcrypt.hash(password, 12)
    await user.save()
    await authRepository.revokeOtherSessions(String(user._id))
  },

  async refresh(refreshToken: string, context: { userAgent?: string; ipAddress?: string }) {
    const session = await authRepository.findSessionByHash(hashToken(refreshToken))
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Phiên đăng nhập đã hết hạn.')
    const { UserModel } = await import('./user.model.js')
    const user = await UserModel.findById(session.userId)
    if (!user || user.status !== 'active') throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Tài khoản không khả dụng.')
    session.revokedAt = new Date()
    await session.save()
    return { user: toSafeUser(user), tokens: await createSession(user, context) }
  },

  async logout(refreshToken?: string) {
    if (refreshToken) await authRepository.revokeSessionByHash(hashToken(refreshToken))
  },

  async loginWithGoogle(
    profile: { googleId: string; email: string; fullName: string; avatarUrl?: string },
    context: { userAgent?: string; ipAddress?: string },
  ) {
    let user = await authRepository.findUserByGoogleId(profile.googleId)
    if (!user) {
      const existing = await authRepository.findUserByEmail(normalizeEmail(profile.email), true)
      if (existing) {
        throw new AppError(409, 'GOOGLE_LINK_REQUIRED', 'Email này đã có tài khoản EduTrack. Vui lòng đăng nhập và liên kết Google trong trang tài khoản.')
      }
      user = await authRepository.createUser({
        fullName: profile.fullName,
        email: normalizeEmail(profile.email),
        username: await createUsername(profile.fullName),
        googleId: profile.googleId,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        role: 'user',
        status: 'active',
        emailVerified: true,
      })
    }
    if (user.status === 'locked') throw new AppError(423, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa.')
    user.lastLoginAt = new Date()
    await user.save()
    return { user: toSafeUser(user), tokens: await createSession(user, context) }
  },

  toSafeUser,
}
