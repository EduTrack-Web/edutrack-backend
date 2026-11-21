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
export const noteTagsRouter = Router()
export const noteImagesRouter = Router()
export const trashedNotesRouter = Router()

notesRouter.use(authenticate)
notesRouter.get('/', getNotes)
notesRouter.post('/', requireCsrf, createNote)
notesRouter.post('/:noteId/copies', requireCsrf, duplicateNote)
notesRouter.get('/:noteId', getNote)
notesRouter.patch('/:noteId', requireCsrf, updateNote)
notesRouter.delete('/:noteId', requireCsrf, moveNoteToTrash)
notesRouter.get('/:noteId/tags', getNoteTags)
notesRouter.put('/:noteId/tags', requireCsrf, setNoteTags)
notesRouter.delete('/:noteId/tags/:tagId', requireCsrf, removeNoteTag)
notesRouter.get('/:noteId/collaborators', getNoteCollaborators)
notesRouter.get('/:noteId/collaborator-candidates', searchShareUsers)
notesRouter.put('/:noteId/collaborators', requireCsrf, setNoteCollaborator)
notesRouter.delete('/:noteId/collaborators/:userId', requireCsrf, removeNoteCollaborator)

noteTagsRouter.use(authenticate)
noteTagsRouter.get('/', getUserTags)
noteTagsRouter.post('/', requireCsrf, createTag)
noteTagsRouter.patch('/:tagId', requireCsrf, updateTag)
noteTagsRouter.delete('/:tagId', requireCsrf, deleteTag)

noteImagesRouter.use(authenticate)
noteImagesRouter.post('/', requireCsrf, uploadNoteImage, uploadImage)

trashedNotesRouter.use(authenticate)
trashedNotesRouter.get('/', getTrashedNotes)
trashedNotesRouter.put('/:noteId', requireCsrf, restoreNote)
trashedNotesRouter.delete('/:noteId', requireCsrf, deleteNotePermanently)

