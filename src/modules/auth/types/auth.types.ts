export type UserRole = 'user' | 'admin'
export type UserStatus = 'pending' | 'active' | 'locked'
export type OtpPurpose = 'registration' | 'password-reset' | 'login-2fa' | 'toggle-2fa'

export interface SafeUser {
  id: string
  fullName: string
  username: string
  email: string
  avatarUrl?: string
  phone?: string
  role: UserRole
  status: UserStatus
  emailVerified: boolean
  twoFactorEnabled: boolean
}
