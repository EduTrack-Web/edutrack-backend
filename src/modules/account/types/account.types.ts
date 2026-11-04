import type { SafeUser, UserType } from '../../auth/types/auth.types.js'

export interface UpdateProfileDto {
  fullName?: string
  username?: string
  phone?: string
  avatarUrl?: string
  userType?: UserType
  organization?: string
  fieldOfStudy?: string
}

export interface ProfileSetupDto {
  userType?: UserType
  username?: string
  organization?: string
  fieldOfStudy?: string
}

export interface UserProfileResponse extends SafeUser {
  lastUsernameChangedAt?: Date | null
  canChangeUsername?: boolean
  daysUntilNextUsernameChange?: number
  hasPassword?: boolean
  isGoogleLinked?: boolean
}

export interface ChangePasswordDto {
  currentPassword?: string
  newPassword: string
  confirmPassword: string
  logoutOtherDevices?: boolean
}

export interface SessionItemResponse {
  id: string
  userAgent?: string
  ipAddress?: string
  lastUsedAt: Date
  createdAt: Date
  isCurrent?: boolean
}

export interface Disable2faDto {
  password?: string
  otpId?: string
  code?: string
  otp?: string
}

export interface DeleteAccountDto {
  password?: string
  otpId?: string
  code?: string
  otp?: string
}
