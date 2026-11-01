import { Router } from 'express'
import { authenticate } from '../../shared/middleware/authenticate.js'
import { getChannels } from './chat.controller.js'

export const chatRouter = Router()

chatRouter.use(authenticate)
chatRouter.get('/channels', getChannels)

