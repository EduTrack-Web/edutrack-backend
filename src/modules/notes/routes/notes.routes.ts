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
export const notesRestRouter = Router()
export const noteTagsRestRouter = Router()
export const noteImagesRestRouter = Router()
export const trashedNotesRestRouter = Router()

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

notesRestRouter.use(authenticate)
notesRestRouter.get('/', getNotes)
notesRestRouter.post('/', requireCsrf, createNote)
notesRestRouter.post('/:noteId/copies', requireCsrf, duplicateNote)
notesRestRouter.get('/:noteId', getNote)
notesRestRouter.patch('/:noteId', requireCsrf, updateNote)
notesRestRouter.delete('/:noteId', requireCsrf, moveNoteToTrash)
notesRestRouter.get('/:noteId/tags', getNoteTags)
notesRestRouter.put('/:noteId/tags', requireCsrf, setNoteTags)
notesRestRouter.delete('/:noteId/tags/:tagId', requireCsrf, removeNoteTag)
notesRestRouter.get('/:noteId/collaborators', getNoteCollaborators)
notesRestRouter.get('/:noteId/collaborator-candidates', searchShareUsers)
notesRestRouter.put('/:noteId/collaborators', requireCsrf, setNoteCollaborator)
notesRestRouter.delete('/:noteId/collaborators/:userId', requireCsrf, removeNoteCollaborator)

noteTagsRestRouter.use(authenticate)
noteTagsRestRouter.get('/', getUserTags)
noteTagsRestRouter.post('/', requireCsrf, createTag)
noteTagsRestRouter.patch('/:tagId', requireCsrf, updateTag)
noteTagsRestRouter.delete('/:tagId', requireCsrf, deleteTag)

noteImagesRestRouter.use(authenticate)
noteImagesRestRouter.post('/', requireCsrf, uploadNoteImage, uploadImage)

trashedNotesRestRouter.use(authenticate)
trashedNotesRestRouter.get('/', getTrashedNotes)
trashedNotesRestRouter.put('/:noteId', requireCsrf, restoreNote)
trashedNotesRestRouter.delete('/:noteId', requireCsrf, deleteNotePermanently)

