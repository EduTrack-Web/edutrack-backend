import type { RequestHandler } from 'express'
import mongoose from 'mongoose'

const databaseStates: Readonly<Record<number, string>> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
}

export const getHealth: RequestHandler = (_request, response) => {
  const databaseState = databaseStates[mongoose.connection.readyState] ?? 'unknown'

  response.status(200).json({
    success: true,
    data: {
      service: 'edutrack-backend',
      status: 'ok',
      database: databaseState,
      timestamp: new Date().toISOString(),
    },
  })
}
