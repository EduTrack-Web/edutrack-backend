import { promises as fs } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcrypt'
import { v2 as cloudinary } from 'cloudinary'

import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'
import { issueOtp, verifyOtp } from '@/modules/auth/services/auth.service.js'
import { hashToken } from '@/modules/auth/services/token.service.js'
import type { SafeUser } from '@/modules/auth/types/auth.types.js'
import { accountRepository } from '@/modules/account/repositories/account.repository.js'
import type {
  ChangePasswordDto,
  DeleteAccountDto,
  Disable2faDto,
  ProfileSetupDto,
  SessionItemResponse,
  UpdateProfileDto,
  UserProfileResponse,
} from '@/modules/account/types/account.types.js'
import { validateUsernameFormat } from '@/modules/account/validations/account.validation.js'

const USERNAME_COOLDOWN_DAYS = 14
const USERNAME_COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000

// Cấu hình Cloudinary nếu đã có biến môi trường
if (env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  })
}

const calculateUsernameCooldown = (lastChangedAt?: Date | null): { canChange: boolean; daysRemaining: number } => {
  if (!lastChangedAt) {
    return { canChange: true, daysRemaining: 0 }
  }

  const elapsedMs = Date.now() - new Date(lastChangedAt).getTime()
  if (elapsedMs >= USERNAME_COOLDOWN_MS) {
    return { canChange: true, daysRemaining: 0 }
  }

  const daysRemaining = Math.ceil((USERNAME_COOLDOWN_MS - elapsedMs) / (24 * 60 * 60 * 1000))
  return { canChange: false, daysRemaining }
}

export const accountService = {
  async getProfile(userId: string): Promise<UserProfileResponse> {
    const user = await accountRepository.findUserWithSecrets(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản.')
    }

    const { canChange, daysRemaining } = calculateUsernameCooldown(user.lastUsernameChangedAt)

    return {
      id: String(user._id),
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl ?? undefined,
      phone: user.phone ?? undefined,
      userType: (user.userType as SafeUser['userType']) ?? undefined,
      organization: user.organization ?? undefined,
      fieldOfStudy: user.fieldOfStudy ?? undefined,
      profileCompleted: Boolean(user.profileCompleted),
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      lastUsernameChangedAt: user.lastUsernameChangedAt,
      canChangeUsername: canChange,
      daysUntilNextUsernameChange: daysRemaining,
      hasPassword: Boolean(user.passwordHash),
      isGoogleLinked: Boolean(user.googleId),
    }
  },

  async updateProfile(userId: string, input: UpdateProfileDto): Promise<UserProfileResponse> {
    const user = await accountRepository.findById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản.')
    }

    const updates: Record<string, unknown> = {}

    // 1. Xử lý đổi tên hiển thị
    if (input.fullName !== undefined) {
      updates.fullName = input.fullName
    }

    // 2. Xử lý đổi số điện thoại
    if (input.phone !== undefined) {
      updates.phone = input.phone
    }

    // 3. Xử lý đổi avatarUrl trực tiếp (nếu có)
    if (input.avatarUrl !== undefined) {
      updates.avatarUrl = input.avatarUrl
    }

    // 4. Xử lý đổi vai trò người dùng (userType)
    if (input.userType !== undefined) {
      updates.userType = input.userType
    }

    // 5. Xử lý đổi đơn vị / trường học (organization)
    if (input.organization !== undefined) {
      updates.organization = input.organization
    }

    // 6. Xử lý đổi lĩnh vực / chuyên ngành (fieldOfStudy)
    if (input.fieldOfStudy !== undefined) {
      updates.fieldOfStudy = input.fieldOfStudy
    }

    // 7. Xử lý đổi Username
    if (input.username && input.username !== user.username) {
      // 7.1. Kiểm tra thời hạn cách 14 ngày
      const { canChange, daysRemaining } = calculateUsernameCooldown(user.lastUsernameChangedAt)
      if (!canChange) {
        throw new AppError(
          400,
          'USERNAME_CHANGE_COOLDOWN',
          `Bạn chỉ có thể đổi tên đăng nhập sau ${daysRemaining} ngày nữa.`,
          { username: `Chưa thể đổi tên đăng nhập. Vui lòng chờ ${daysRemaining} ngày nữa.` },
        )
      }

      // 7.2. Kiểm tra trùng lặp username
      const existingUser = await accountRepository.findByUsername(input.username)
      if (existingUser && String(existingUser._id) !== userId) {
        throw new AppError(
          409,
          'USERNAME_ALREADY_EXISTS',
          'Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.',
          { username: 'Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.' },
        )
      }

      updates.username = input.username
      updates.lastUsernameChangedAt = new Date()
    }

    const updatedUser = await accountRepository.updateUser(userId, updates)
    if (!updatedUser) {
      throw new AppError(500, 'UPDATE_FAILED', 'Không thể cập nhật thông tin lúc này.')
    }

    const cooldown = calculateUsernameCooldown(updatedUser.lastUsernameChangedAt)

    return {
      id: String(updatedUser._id),
      fullName: updatedUser.fullName,
      username: updatedUser.username,
      email: updatedUser.email,
      avatarUrl: updatedUser.avatarUrl ?? undefined,
      phone: updatedUser.phone ?? undefined,
      userType: (updatedUser.userType as SafeUser['userType']) ?? undefined,
      organization: updatedUser.organization ?? undefined,
      fieldOfStudy: updatedUser.fieldOfStudy ?? undefined,
      profileCompleted: Boolean(updatedUser.profileCompleted),
      role: updatedUser.role,
      status: updatedUser.status,
      emailVerified: updatedUser.emailVerified,
      twoFactorEnabled: updatedUser.twoFactorEnabled,
      lastUsernameChangedAt: updatedUser.lastUsernameChangedAt,
      canChangeUsername: cooldown.canChange,
      daysUntilNextUsernameChange: cooldown.daysRemaining,
    }
  },

  async checkUsernameAvailability(userId: string, username: string): Promise<{ available: boolean; message?: string }> {
    const formatError = validateUsernameFormat(username)
    if (formatError) {
      return {
        available: false,
        message: formatError,
      }
    }

    const normalized = username.trim().toLowerCase()

    const existing = await accountRepository.findByUsername(normalized)
    if (existing && String(existing._id) !== userId) {
      return {
        available: false,
        message: 'Tên đăng nhập này đã được sử dụng.',
      }
    }

    return {
      available: true,
      message: 'Tên đăng nhập khả dụng.',
    }
  },

  async setupProfile(userId: string, input: ProfileSetupDto): Promise<UserProfileResponse> {
    const user = await accountRepository.findById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản.')
    }

    const updates: Record<string, unknown> = {
      profileCompleted: true,
    }

    if (input.userType) {
      updates.userType = input.userType
    }

    if (input.organization !== undefined) {
      updates.organization = input.organization
    }

    if (input.fieldOfStudy !== undefined) {
      updates.fieldOfStudy = input.fieldOfStudy
    }

    // Xử lý đổi Username trong bước Onboarding
    if (input.username && input.username !== user.username) {
      const existingUser = await accountRepository.findByUsername(input.username)
      if (existingUser && String(existingUser._id) !== userId) {
        throw new AppError(
          409,
          'USERNAME_ALREADY_EXISTS',
          'Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.',
          { username: 'Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.' },
        )
      }
      updates.username = input.username
      updates.lastUsernameChangedAt = new Date()
    }

    const updatedUser = await accountRepository.updateUser(userId, updates)
    if (!updatedUser) {
      throw new AppError(500, 'SETUP_FAILED', 'Không thể hoàn thiện hồ sơ lúc này.')
    }

    const cooldown = calculateUsernameCooldown(updatedUser.lastUsernameChangedAt)

    return {
      id: String(updatedUser._id),
      fullName: updatedUser.fullName,
      username: updatedUser.username,
      email: updatedUser.email,
      avatarUrl: updatedUser.avatarUrl ?? undefined,
      phone: updatedUser.phone ?? undefined,
      userType: (updatedUser.userType as SafeUser['userType']) ?? undefined,
      organization: updatedUser.organization ?? undefined,
      fieldOfStudy: updatedUser.fieldOfStudy ?? undefined,
      profileCompleted: true,
      role: updatedUser.role,
      status: updatedUser.status,
      emailVerified: updatedUser.emailVerified,
      twoFactorEnabled: updatedUser.twoFactorEnabled,
      lastUsernameChangedAt: updatedUser.lastUsernameChangedAt,
      canChangeUsername: cooldown.canChange,
      daysUntilNextUsernameChange: cooldown.daysRemaining,
      hasPassword: Boolean(updatedUser.passwordHash),
      isGoogleLinked: Boolean(updatedUser.googleId),
    }
  },

  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<{ avatarUrl: string }> {
    const user = await accountRepository.findById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản.')
    }

    let finalAvatarUrl: string

    // Nếu Cloudinary đã được cấu hình -> tải lên Cloudinary
    if (env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret) {
      finalAvatarUrl = await new Promise<string>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'edutrack/avatars',
            public_id: `avatar_${userId}_${Date.now()}`,
            transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
          },
          (error, result) => {
            if (error || !result) {
              reject(new AppError(502, 'CLOUDINARY_UPLOAD_FAILED', 'Không thể tải ảnh lên Cloudinary lúc này.'))
            } else {
              resolve(result.secure_url)
            }
          },
        )
        uploadStream.end(file.buffer)
      })
    } else {
      // Fallback khi chạy Local Dev chưa cấu hình Cloudinary: lưu file vào public/uploads/avatars
      const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads', 'avatars')
      await fs.mkdir(uploadsDir, { recursive: true })

      const ext = path.extname(file.originalname) || '.png'
      const fileName = `avatar_${userId}_${Date.now()}${ext}`
      const filePath = path.join(uploadsDir, fileName)

      await fs.writeFile(filePath, file.buffer)
      finalAvatarUrl = `/uploads/avatars/${fileName}`
    }

    await accountRepository.updateUser(userId, { avatarUrl: finalAvatarUrl })

    return { avatarUrl: finalAvatarUrl }
  },

  async changePassword(userId: string, input: ChangePasswordDto, currentRefreshToken?: string): Promise<{ message: string }> {
    const user = await accountRepository.findUserWithPassword(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản.')
    }

    // 1. Kiểm tra mật khẩu cũ nếu tài khoản đã có mật khẩu
    if (user.passwordHash) {
      if (!input.currentPassword) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng nhập mật khẩu hiện tại.', {
          currentPassword: 'Vui lòng nhập mật khẩu hiện tại.',
        })
      }
      const isCurrentMatch = await bcrypt.compare(input.currentPassword, user.passwordHash)
      if (!isCurrentMatch) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Mật khẩu hiện tại không chính xác.', {
          currentPassword: 'Mật khẩu hiện tại không chính xác.',
        })
      }

      // Mật khẩu mới không được trùng mật khẩu cũ
      const isSameAsOld = await bcrypt.compare(input.newPassword, user.passwordHash)
      if (isSameAsOld) {
        throw new AppError(422, 'PASSWORD_REUSED', 'Mật khẩu mới phải khác mật khẩu hiện tại.', {
          newPassword: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.',
        })
      }
    }

    // 2. Hash mật khẩu mới và lưu
    user.passwordHash = await bcrypt.hash(input.newPassword, 12)
    await user.save()

    // 3. Đăng xuất các thiết bị khác nếu người dùng chọn
    if (input.logoutOtherDevices) {
      const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : undefined
      await accountRepository.revokeOtherSessions(userId, currentHash)
    }

    return { message: 'Đổi mật khẩu thành công.' }
  },

  async getActiveSessions(userId: string, currentRefreshToken?: string): Promise<SessionItemResponse[]> {
    const sessions = await accountRepository.findActiveSessions(userId)
    const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : undefined

    return sessions.map((session) => ({
      id: String(session._id),
      userAgent: session.userAgent || 'Thiết bị không xác định',
      ipAddress: session.ipAddress || 'Không rõ IP',
      lastUsedAt: session.lastUsedAt,
      createdAt: session.createdAt,
      isCurrent: Boolean(currentHash && session.tokenHash === currentHash),
    }))
  },

  async revokeOtherSessions(userId: string, currentRefreshToken?: string): Promise<{ message: string }> {
    const currentHash = currentRefreshToken ? hashToken(currentRefreshToken) : undefined
    await accountRepository.revokeOtherSessions(userId, currentHash)
    return { message: 'Đã đăng xuất khỏi tất cả các thiết bị khác.' }
  },

  async send2faOtp(userId: string): Promise<{ otpId: string; message: string }> {
    const user = await accountRepository.findById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    }
    const otpId = await issueOtp(userId, user.email, 'toggle-2fa')
    return { otpId, message: 'Mã xác thực OTP đã được gửi đến email của bạn.' }
  },

  async enable2fa(userId: string, otpId: string, code: string): Promise<{ message: string }> {
    const user = await accountRepository.findById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    }
    if (user.twoFactorEnabled) {
      return { message: 'Xác thực 2 bước đã được kích hoạt trước đó.' }
    }
    await verifyOtp(otpId, code, 'toggle-2fa')
    user.twoFactorEnabled = true
    await user.save()
    return { message: 'Kích hoạt xác thực 2 bước (2FA) thành công.' }
  },

  async disable2fa(userId: string, input: Disable2faDto): Promise<{ message: string }> {
    const user = await accountRepository.findUserWithSecrets(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    }
    if (!user.twoFactorEnabled) {
      return { message: 'Xác thực 2 bước hiện đang tắt.' }
    }

    if (user.passwordHash) {
      if (!input.password) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng nhập mật khẩu xác nhận.', {
          password: 'Vui lòng nhập mật khẩu xác nhận.',
        })
      }
      const isMatch = await bcrypt.compare(input.password, user.passwordHash)
      if (!isMatch) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Mật khẩu xác nhận không chính xác.', {
          password: 'Mật khẩu xác nhận không chính xác.',
        })
      }
    } else {
      const otpCode = (input.code || input.otp)?.trim()
      if (!input.otpId || !otpCode) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng nhập mã OTP để xác nhận tắt 2FA.', {
          code: 'Vui lòng nhập mã OTP để xác nhận tắt 2FA.',
        })
      }
      await verifyOtp(input.otpId, otpCode, 'toggle-2fa')
    }

    user.twoFactorEnabled = false
    await user.save()
    return { message: 'Đã tắt xác thực 2 bước (2FA) thành công.' }
  },

  async unlinkGoogle(userId: string): Promise<{ message: string }> {
    const user = await accountRepository.findUserWithSecrets(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    }
    if (!user.googleId) {
      throw new AppError(400, 'GOOGLE_NOT_LINKED', 'Tài khoản chưa được liên kết với Google.')
    }
    if (!user.passwordHash) {
      throw new AppError(
        400,
        'PASSWORD_REQUIRED',
        'Không thể hủy liên kết Google vì tài khoản chưa thiết lập mật khẩu. Vui lòng tạo mật khẩu trước khi hủy liên kết.',
      )
    }
    await accountRepository.unlinkGoogle(userId)
    return { message: 'Đã hủy liên kết tài khoản Google thành công.' }
  },

  async sendDeleteAccountOtp(userId: string): Promise<{ otpId: string; message: string }> {
    const user = await accountRepository.findById(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    }
    if (user.role === 'admin') {
      throw new AppError(403, 'ADMIN_CANNOT_BE_DELETED', 'Không thể xóa tài khoản Quản trị viên hệ thống.')
    }
    const otpId = await issueOtp(userId, user.email, 'delete-account')
    return { otpId, message: 'Mã xác nhận xóa tài khoản đã được gửi đến email của bạn.' }
  },

  async deleteAccount(userId: string, input: DeleteAccountDto): Promise<{ message: string }> {
    const user = await accountRepository.findUserWithSecrets(userId)
    if (!user || user.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    }
    if (user.role === 'admin') {
      throw new AppError(403, 'ADMIN_CANNOT_BE_DELETED', 'Không thể xóa tài khoản Quản trị viên hệ thống.')
    }

    if (user.passwordHash) {
      if (!input.password) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng nhập mật khẩu hiện tại để xác nhận xóa tài khoản.', {
          password: 'Vui lòng nhập mật khẩu hiện tại để xác nhận xóa tài khoản.',
        })
      }
      const isMatch = await bcrypt.compare(input.password, user.passwordHash)
      if (!isMatch) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Mật khẩu xác nhận không chính xác.', {
          password: 'Mật khẩu xác nhận không chính xác.',
        })
      }
    } else {
      const otpCode = (input.code || input.otp)?.trim()
      if (!input.otpId || !otpCode) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng nhập mã OTP để xác nhận xóa tài khoản.', {
          code: 'Vui lòng nhập mã OTP để xác nhận xóa tài khoản.',
        })
      }
      await verifyOtp(input.otpId, otpCode, 'delete-account')
    }

    await accountRepository.deleteUserAndData(userId)
    return { message: 'Tài khoản của bạn đã được xóa vĩnh viễn thành công.' }
  },
}
