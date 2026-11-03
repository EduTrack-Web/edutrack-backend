import { Router } from 'express'

import { authenticate } from '../../../shared/middleware/authenticate.js'
import { requireCsrf } from '../../../shared/middleware/csrf.js'
import { createNote, getNote, getNotes, updateNote, uploadImage } from '../controllers/notes.controller.js'
import { uploadNoteImage } from '../middleware/note-image-upload.js'

export const notesRouter = Router()

notesRouter.use(authenticate)
notesRouter.get('/', getNotes)
notesRouter.post('/', requireCsrf, createNote)
notesRouter.post('/images', requireCsrf, uploadNoteImage, uploadImage)
notesRouter.get('/:noteId', getNote)
notesRouter.patch('/:noteId', requireCsrf, updateNote)

