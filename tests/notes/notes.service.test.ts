import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '../../src/shared/errors/app-error.js'
import { NOTE_DEFAULT_TITLE } from '../../src/modules/notes/config/notes.config.js'
import {
  createNotesService,
  type NotesRepositoryContract,
  type PersistedNote,
} from '../../src/modules/notes/services/notes.service.js'
import type { NoteContentNode } from '../../src/modules/notes/types/notes.types.js'

const ownerId = new Types.ObjectId().toString()
const noteId = new Types.ObjectId().toString()
const emptyContent: NoteContentNode = { type: 'doc', content: [{ type: 'paragraph' }] }

const persistedNote = (overrides: Partial<PersistedNote> = {}): PersistedNote => ({
  _id: noteId,
  title: NOTE_DEFAULT_TITLE,
  content: emptyContent,
  plainText: '',
  version: 1,
  createdAt: new Date('2026-10-28T08:00:00.000Z'),
  updatedAt: new Date('2026-10-28T08:00:00.000Z'),
  ...overrides,
})

const createRepository = (overrides: Partial<NotesRepositoryContract> = {}): NotesRepositoryContract => ({
  findNotesByUserId: async () => [],
  findOwnedNoteById: async () => null,
  createNote: async () => persistedNote(),
  updateOwnedNote: async () => null,
  ...overrides,
})

test('creates an owned note immediately with the default title and empty JSON document', async () => {
  let receivedOwnerId = ''
  let receivedTitle = ''
  let receivedContent: NoteContentNode | undefined
  const service = createNotesService(createRepository({
    createNote: async (userId, title, content) => {
      receivedOwnerId = userId
      receivedTitle = title
      receivedContent = content
      return persistedNote()
    },
  }))

  const note = await service.createNote(ownerId)

  assert.equal(receivedOwnerId, ownerId)
  assert.equal(receivedTitle, NOTE_DEFAULT_TITLE)
  assert.deepEqual(receivedContent, emptyContent)
  assert.equal(note.title, NOTE_DEFAULT_TITLE)
  assert.equal(note.version, 1)
})

test('uses both owner id and note id when loading an editable note', async () => {
  let receivedOwnerId = ''
  let receivedNoteId = ''
  const service = createNotesService(createRepository({
    findOwnedNoteById: async (userId, requestedNoteId) => {
      receivedOwnerId = userId
      receivedNoteId = requestedNoteId
      return persistedNote()
    },
  }))

  await service.getNote(ownerId, noteId)

  assert.equal(receivedOwnerId, ownerId)
  assert.equal(receivedNoteId, noteId)
})

test('does not reveal whether a note exists when it is not owned by the current user', async () => {
  const service = createNotesService(createRepository())

  await assert.rejects(
    service.getNote(ownerId, noteId),
    (error: unknown) => error instanceof AppError && error.statusCode === 404 && error.code === 'NOTE_NOT_FOUND',
  )
})
