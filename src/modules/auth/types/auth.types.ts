export type UserRole = 'user' | 'admin'
export type UserStatus = 'pending' | 'active' | 'locked'
export type UserType = 'student' | 'pupil' | 'worker' | 'teacher' | 'other'
export type OtpPurpose = 'registration' | 'password-reset' | 'login-2fa' | 'toggle-2fa' | 'delete-account'

export interface SafeUser {
  id: string
  fullName: string
  username: string
  email: string
  avatarUrl?: string
  phone?: string
  userType?: UserType
  organization?: string
  fieldOfStudy?: string
  profileCompleted: boolean
  role: UserRole
  status: UserStatus
  emailVerified: boolean
  twoFactorEnabled: boolean
}
