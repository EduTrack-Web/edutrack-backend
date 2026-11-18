import { Router } from 'express'

import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  createNote,
  createTag,
  deleteTag,
  deleteNotePermanently,
  duplicateNote,
  getNote,
  getNotes,
  getNoteTags,
  getTrashedNotes,
  getUserTags,
  moveNoteToTrash,
  restoreNote,
  removeNoteTag,
  setNoteTags,
  updateTag,
  updateNote,
  uploadImage,
} from '@/modules/notes/controllers/notes.controller.js'
import { uploadNoteImage } from '@/modules/notes/middleware/note-image-upload.js'
import {
  getNoteCollaborators,
  removeNoteCollaborator,
  searchShareUsers,
  setNoteCollaborator,
} from '@/modules/notes/controllers/note-shares.controller.js'

export const notesRouter = Router()

notesRouter.use(authenticate)
notesRouter.get('/', getNotes)
notesRouter.post('/', requireCsrf, createNote)
notesRouter.post('/images', requireCsrf, uploadNoteImage, uploadImage)
notesRouter.get('/trash', getTrashedNotes)
notesRouter.get('/tags', getUserTags)
notesRouter.post('/tags', requireCsrf, createTag)
notesRouter.patch('/tags/:tagId', requireCsrf, updateTag)
notesRouter.delete('/tags/:tagId', requireCsrf, deleteTag)
notesRouter.get('/:noteId/tags', getNoteTags)
notesRouter.put('/:noteId/tags', requireCsrf, setNoteTags)
notesRouter.delete('/:noteId/tags/:tagId', requireCsrf, removeNoteTag)
notesRouter.get('/:noteId/shares', getNoteCollaborators)
notesRouter.get('/:noteId/share-users', searchShareUsers)
notesRouter.put('/:noteId/shares', requireCsrf, setNoteCollaborator)
notesRouter.delete('/:noteId/shares/:userId', requireCsrf, removeNoteCollaborator)
notesRouter.post('/:noteId/duplicate', requireCsrf, duplicateNote)
notesRouter.get('/:noteId', getNote)
notesRouter.patch('/:noteId', requireCsrf, updateNote)
notesRouter.delete('/:noteId', requireCsrf, moveNoteToTrash)
notesRouter.post('/:noteId/restore', requireCsrf, restoreNote)
notesRouter.delete('/:noteId/permanent', requireCsrf, deleteNotePermanently)

