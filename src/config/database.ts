import mongoose from 'mongoose'

export const connectDatabase = async (mongoUri: string): Promise<void> => {
  await mongoose.connect(mongoUri)
}

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect()
}
