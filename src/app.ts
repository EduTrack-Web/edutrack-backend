import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'

import { env } from './config/env.js'
import { apiRouter } from './routes/index.js'
import { errorHandler } from './shared/middleware/error-handler.js'
import { notFoundHandler } from './shared/middleware/not-found.js'

export const createApp = (): express.Express => {
  const app = express()

  app.disable('x-powered-by')
  if (env.nodeEnv === 'production') app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({ origin: env.clientOrigins, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(cookieParser())

  app.use('/v1/api', apiRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
