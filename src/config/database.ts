import mongoose from 'mongoose'
import { syncGoogleCalendarIndexes } from '@/modules/calendar/repositories/google-calendar.repository.js'

export const connectDatabase = async (mongoUri: string): Promise<void> => {
  await mongoose.connect(mongoUri)
  await syncGoogleCalendarIndexes()
}

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect()
}
