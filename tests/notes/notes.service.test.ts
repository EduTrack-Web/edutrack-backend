import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '../../src/shared/errors/app-error.js'
import { NOTE_DEFAULT_TITLE } from '../../src/modules/notes/config/notes.config.js'
import {
  createNotesService,
  sortNotesBySearchRelevance,
  type NoteAccessContract,
  type NoteImageCleanupContract,
  type NoteTagAssignmentContract,
  type NotesRepositoryContract,
  type PersistedNote,
} from '../../src/modules/notes/services/notes.service.js'
import type { NoteContentNode } from '../../src/modules/notes/types/notes.types.js'

const ownerId = new Types.ObjectId().toString()
const noteId = new Types.ObjectId().toString()
const emptyContent: NoteContentNode = { type: 'doc', content: [{ type: 'paragraph' }] }

const persistedNote = (overrides: Partial<PersistedNote> = {}): PersistedNote => ({
  _id: noteId,
  ownerId,
  title: NOTE_DEFAULT_TITLE,
  content: emptyContent,
  plainText: '',
  background: 'default',
  version: 1,
  createdAt: new Date('2026-10-28T08:00:00.000Z'),
  updatedAt: new Date('2026-10-28T08:00:00.000Z'),
  deletedAt: null,
  purgeAt: null,
  ...overrides,
})

const createRepository = (overrides: Partial<NotesRepositoryContract> = {}): NotesRepositoryContract => ({
  findNotesByUserId: async () => [],
  findAccessibleNotes: async () => [],
  findTrashedNotesByUserId: async () => [],
  findOwnedNoteById: async () => null,
  findActiveNoteById: async () => null,
  findOwnedTrashedNoteById: async () => null,
  createNote: async () => persistedNote(),
  createDuplicatedNote: async (_userId, title, content, plainText, background) => persistedNote({
    title,
    content,
    plainText,
    background,
  }),
  deleteOwnedActiveNote: async () => null,
  updateOwnedNote: async () => null,
  updateActiveNoteById: async () => null,
  moveOwnedNoteToTrash: async () => null,
  restoreOwnedNote: async () => null,
  deleteOwnedTrashedNote: async () => null,
  findExpiredTrashedNotes: async () => [],
  deleteExpiredTrashedNote: async () => null,
  ...overrides,
})

const createImageCleanup = (
  overrides: Partial<NoteImageCleanupContract> = {},
): NoteImageCleanupContract => ({
  destroyMany: async () => undefined,
  duplicateContent: async (content) => ({ content, createdPublicIds: [] }),
  ...overrides,
})

const createTagAssignments = (
  overrides: Partial<NoteTagAssignmentContract> = {},
): NoteTagAssignmentContract => ({
  copyTagAssignments: async () => undefined,
  deleteAssignmentsForNote: async () => undefined,
  ...overrides,
})

const createAccessControl = (
  repository: NotesRepositoryContract,
  overrides: Partial<NoteAccessContract> = {},
): NoteAccessContract => ({
  getNoteAccess: async (userId, requestedNoteId) => {
    const note = await repository.findOwnedNoteById(userId, requestedNoteId)
    return note ? {
      note,
      access: { role: 'owner', canEdit: true, canManageAccess: true, isSharedWithMe: false },
    } : null
  },
  getSharedNoteIds: async () => [],
  getSharedAccessByNoteId: async () => ({}),
  deleteSharesForNote: async () => undefined,
  ...overrides,
})

const createService = (
  repository: NotesRepositoryContract,
  imageCleanup: NoteImageCleanupContract = createImageCleanup(),
  tagAssignments: NoteTagAssignmentContract = createTagAssignments(),
  accessOverrides: Partial<NoteAccessContract> = {},
) => createNotesService(
  repository,
  imageCleanup,
  tagAssignments,
  createAccessControl(repository, accessOverrides),
)

test('creates an owned note immediately with the default title and empty JSON document', async () => {
  let receivedOwnerId = ''
  let receivedTitle = ''
  let receivedContent: NoteContentNode | undefined
  const service = createService(createRepository({
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
  const service = createService(createRepository({
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
  const service = createService(createRepository())

  await assert.rejects(
    service.getNote(ownerId, noteId),
    (error: unknown) => error instanceof AppError && error.statusCode === 404 && error.code === 'NOTE_NOT_FOUND',
  )
})

test('searches owned and shared notes and preserves shared access metadata', async () => {
  let receivedQuery = ''
  const repository = createRepository({
    findAccessibleNotes: async (_userId, _sharedNoteIds, query) => {
      receivedQuery = query
      return [persistedNote({ ownerId: new Types.ObjectId().toString(), title: 'Kế hoạch ôn thi' })]
    },
  })
  const service = createService(repository, createImageCleanup(), createTagAssignments(), {
    getSharedNoteIds: async () => [noteId],
    getSharedAccessByNoteId: async () => ({
      [noteId]: { role: 'edit', canEdit: true, canManageAccess: true, isSharedWithMe: true },
    }),
  })

  const notes = await service.getUserNotes(ownerId, '  ôn   thi  ')

  assert.equal(receivedQuery, 'ôn thi')
  assert.equal(notes[0]?.access.role, 'edit')
  assert.equal(notes[0]?.access.isSharedWithMe, true)
})

test('ranks a title that starts with a partial query before content-only matches', () => {
  const titleMatch = persistedNote({ _id: new Types.ObjectId(), title: 'zzzz', plainText: '' })
  const contentMatch = persistedNote({ _id: new Types.ObjectId(), title: 'Khác', plainText: 'Có chữ z trong nội dung' })

  const result = sortNotesBySearchRelevance([contentMatch, titleMatch], 'z')

  assert.equal(result[0]?.title, 'zzzz')
})

test('validates and persists the selected note background with autosave content', async () => {
  let receivedBackground = ''
  const service = createService(createRepository({
    findOwnedNoteById: async () => persistedNote(),
    updateActiveNoteById: async (_noteId, update) => {
      receivedBackground = update.background ?? ''
      return persistedNote({
        title: update.title,
        content: update.content,
        plainText: update.plainText,
        background: update.background ?? 'default',
        version: 2,
      })
    },
  }))

  const updated = await service.updateNote(ownerId, noteId, {
    title: 'Màu nền mới',
    background: 'blue',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nội dung' }] }] },
  })

  assert.equal(receivedBackground, 'blue')
  assert.equal(updated.background, 'blue')
  assert.equal(updated.version, 2)
})

test('rejects note background values outside the configured palette', async () => {
  const service = createService(createRepository({ findOwnedNoteById: async () => persistedNote() }))

  await assert.rejects(
    service.updateNote(ownerId, noteId, {
      title: 'Màu không hợp lệ',
      background: 'transparent-script',
      content: emptyContent,
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'VALIDATION_ERROR'
      && error.fieldErrors?.background === 'Màu nền ghi chú không hợp lệ.',
  )
})

test('rejects content updates from a collaborator with view-only permission', async () => {
  const repository = createRepository()
  const service = createService(repository, createImageCleanup(), createTagAssignments(), {
    getNoteAccess: async () => ({
      note: persistedNote(),
      access: { role: 'view', canEdit: false, canManageAccess: true, isSharedWithMe: true },
    }),
  })

  await assert.rejects(
    service.updateNote(ownerId, noteId, { title: 'Không được lưu', content: emptyContent }),
    (error: unknown) => error instanceof AppError && error.code === 'NOTE_EDIT_FORBIDDEN',
  )
})

test('moves an owned note to trash for exactly 30 days', async () => {
  const deletedAt = new Date('2026-11-04T08:00:00.000Z')
  let receivedPurgeAt: Date | undefined
  const service = createService(createRepository({
    moveOwnedNoteToTrash: async (_userId, _noteId, receivedDeletedAt, purgeAt) => {
      assert.equal(receivedDeletedAt, deletedAt)
      receivedPurgeAt = purgeAt
      return persistedNote({ deletedAt, purgeAt })
    },
  }))

  const trashed = await service.moveNoteToTrash(ownerId, noteId, deletedAt)

  assert.equal(receivedPurgeAt?.toISOString(), '2026-12-04T08:00:00.000Z')
  assert.equal(trashed.deletedAt, deletedAt.toISOString())
  assert.equal(trashed.purgeAt, '2026-12-04T08:00:00.000Z')
})

test('restores a note and clears its trash timestamps through the repository', async () => {
  const service = createService(createRepository({
    restoreOwnedNote: async () => persistedNote({ deletedAt: null, purgeAt: null }),
  }))

  const restored = await service.restoreNote(ownerId, noteId)

  assert.equal(restored.id, noteId)
})

test('removes Cloudinary images before permanently deleting a trashed note', async () => {
  const imageContent: NoteContentNode = {
    type: 'doc',
    content: [{
      type: 'image',
      attrs: { src: 'https://example.test/note.png', publicId: `edutrack/notes/${ownerId}/image-1` },
    }],
  }
  const calls: string[] = []
  const service = createService(createRepository({
    findOwnedTrashedNoteById: async () => persistedNote({
      content: imageContent,
      deletedAt: new Date('2026-11-04T08:00:00.000Z'),
      purgeAt: new Date('2026-12-04T08:00:00.000Z'),
    }),
    deleteOwnedTrashedNote: async () => {
      calls.push('database')
      return persistedNote()
    },
  }), createImageCleanup({
    destroyMany: async (publicIds) => {
      calls.push(...publicIds)
    },
  }), createTagAssignments())

  await service.deleteNotePermanently(ownerId, noteId)

  assert.deepEqual(calls, [`edutrack/notes/${ownerId}/image-1`, 'database'])
})

test('keeps an expired note for retry when image cleanup fails', async () => {
  let deleteAttempted = false
  const expired = persistedNote({
    deletedAt: new Date('2026-10-01T08:00:00.000Z'),
    purgeAt: new Date('2026-10-31T08:00:00.000Z'),
  })
  const service = createService(createRepository({
    findExpiredTrashedNotes: async () => [expired],
    deleteExpiredTrashedNote: async () => {
      deleteAttempted = true
      return expired
    },
  }), createImageCleanup({
    destroyMany: async () => {
      throw new Error('Cloudinary unavailable')
    },
  }))

  const result = await service.purgeExpiredNotes(new Date('2026-11-04T08:00:00.000Z'))

  assert.deepEqual(result, { deleted: 0, failed: 1 })
  assert.equal(deleteAttempted, false)
})

test('duplicates content, background and personal tag assignments with a localized title', async () => {
  let copiedTagsFrom = ''
  let copiedTagsTo = ''
  const duplicatedId = new Types.ObjectId().toString()
  const service = createService(createRepository({
    findOwnedNoteById: async () => persistedNote({ title: 'Kế hoạch', background: 'mint' }),
    createDuplicatedNote: async (_userId, title, content, plainText, background) => persistedNote({
      _id: duplicatedId,
      title,
      content,
      plainText,
      background,
    }),
  }), createImageCleanup(), createTagAssignments({
    copyTagAssignments: async (_userId, sourceNoteId, targetNoteId) => {
      copiedTagsFrom = sourceNoteId
      copiedTagsTo = targetNoteId
    },
  }))

  const duplicate = await service.duplicateNote(ownerId, noteId, { language: 'vi' })

  assert.equal(duplicate.title, 'Bản sao của Kế hoạch')
  assert.equal(duplicate.background, 'mint')
  assert.equal(copiedTagsFrom, noteId)
  assert.equal(copiedTagsTo, duplicatedId)
})

test('uses the English copy prefix when the current interface language is English', async () => {
  const service = createService(createRepository({
    findOwnedNoteById: async () => persistedNote({ title: 'Study plan' }),
  }), createImageCleanup(), createTagAssignments())

  const duplicate = await service.duplicateNote(ownerId, noteId, { language: 'en' })

  assert.equal(duplicate.title, 'Copy of Study plan')
})
