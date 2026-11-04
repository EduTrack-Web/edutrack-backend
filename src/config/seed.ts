import bcrypt from 'bcrypt'

import { env } from './env.js'
import { UserModel } from '../modules/auth/models/user.model.js'

const developmentUsers = [
  { fullName: 'Development User', username: 'user', email: 'user@edutrack.local', password: 'User@123', role: 'user' },
  { fullName: 'Development Admin', username: 'admin', email: 'admin@edutrack.local', password: 'Admin@123', role: 'admin' },
] as const

export const seedDevelopmentUsers = async (): Promise<void> => {
  if (env.nodeEnv !== 'development') return

  for (const account of developmentUsers) {
    const passwordHash = await bcrypt.hash(account.password, 12)
    await UserModel.updateOne(
      { username: account.username },
      {
        $set: {
          fullName: account.fullName,
          email: account.email,
          passwordHash,
          role: account.role,
          userType: account.role === 'admin' ? 'teacher' : 'student',
          organization: 'Trường Đại học Sư phạm Kỹ thuật TP.HCM (HCMUTE)',
          fieldOfStudy: 'Khoa học Tự nhiên & Công nghệ',
          profileCompleted: true,
          status: 'active',
          emailVerified: true,
        },
        $setOnInsert: { username: account.username, twoFactorEnabled: false },
      },
      { upsert: true },
    )
  }
}
