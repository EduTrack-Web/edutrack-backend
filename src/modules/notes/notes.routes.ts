import { Router } from 'express'
import { authenticate } from '../../shared/middleware/authenticate.js'
import { getNotes } from './notes.controller.js'

export const notesRouter = Router()

notesRouter.use(authenticate)
notesRouter.get('/', getNotes)

