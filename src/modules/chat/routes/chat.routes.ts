import { Router } from 'express'
import { authenticate } from '../../../shared/middleware/authenticate.js'
import { getChannels } from '../controllers/chat.controller.js'

export const chatRouter = Router()

chatRouter.use(authenticate)
chatRouter.get('/channels', getChannels)

