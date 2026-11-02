import { Router } from 'express'
import { authenticate } from '../../../shared/middleware/authenticate.js'
import { getNotes } from '../controllers/notes.controller.js'

export const notesRouter = Router()

notesRouter.use(authenticate)
notesRouter.get('/', getNotes)

