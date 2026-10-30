import bcrypt from 'bcrypt'

import { env } from './env.js'
import { UserModel } from '../modules/auth/user.model.js'

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
          status: 'active',
          emailVerified: true,
        },
        $setOnInsert: { username: account.username, twoFactorEnabled: false },
      },
      { upsert: true },
    )
  }
}
