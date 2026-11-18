import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import {
  createNoteSharesService,
  type NoteSharesRepositoryContract,
  type NotesAccessRepositoryContract,
} from '@/modules/notes/services/note-shares.service.js'

const ownerId = new Types.ObjectId().toString()
const collaboratorId = new Types.ObjectId().toString()
const targetId = new Types.ObjectId().toString()
const noteId = new Types.ObjectId().toString()

const noteRepository: NotesAccessRepositoryContract = {
  findActiveNoteById: async () => ({ _id: noteId, ownerId }),
}

const createRepository = (
  overrides: Partial<NoteSharesRepositoryContract> = {},
): NoteSharesRepositoryContract => ({
  findShare: async () => null,
  findSharedNoteIds: async () => [],
  findSharesForUser: async () => [],
  findSharesByNoteId: async () => [],
  searchActiveUsers: async () => [],
  findActiveUserById: async () => null,
  findUserById: async () => ({ _id: ownerId, fullName: 'Owner', username: 'owner' }),
  upsertShare: async () => ({}),
  deleteShare: async () => ({}),
  deleteSharesForNote: async () => ({}),
  ...overrides,
})

test('grants direct collaborators permission to manage access', async () => {
  const service = createNoteSharesService(createRepository({
    findShare: async () => ({ noteId, userId: collaboratorId, permission: 'view' }),
  }), noteRepository)

  const access = await service.getNoteAccess(collaboratorId, noteId)

  assert.deepEqual(access?.access, {
    role: 'view',
    canEdit: false,
    canManageAccess: true,
    isSharedWithMe: true,
  })
})

test('prevents a collaborator from promoting their own content permission', async () => {
  const service = createNoteSharesService(createRepository({
    findShare: async () => ({ noteId, userId: collaboratorId, permission: 'view' }),
  }), noteRepository)

  await assert.rejects(
    service.setCollaborator(collaboratorId, noteId, { userId: collaboratorId, permission: 'edit' }),
    (error: unknown) => error instanceof AppError && error.code === 'NOTE_SELF_PERMISSION_IMMUTABLE',
  )
})

test('allows a direct collaborator to grant another user access', async () => {
  let grantedBy = ''
  const service = createNoteSharesService(createRepository({
    findShare: async () => ({ noteId, userId: collaboratorId, permission: 'view' }),
    findActiveUserById: async () => ({ _id: targetId, fullName: 'Target User', username: 'target' }),
    upsertShare: async (_noteId, _userId, _permission, actorId) => {
      grantedBy = actorId
      return {}
    },
  }), noteRepository)

  const collaborator = await service.setCollaborator(
    collaboratorId,
    noteId,
    { userId: targetId, permission: 'edit' },
  )

  assert.equal(grantedBy, collaboratorId)
  assert.equal(collaborator.permission, 'edit')
  assert.equal(collaborator.id, targetId)
})
