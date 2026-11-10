import { Router } from 'express'

import { getHealth } from '@/modules/health/controllers/health.controller.js'

export const healthRouter = Router()

healthRouter.get('/', getHealth)
