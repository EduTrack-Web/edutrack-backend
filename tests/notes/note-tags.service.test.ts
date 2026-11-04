import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '../../src/shared/errors/app-error.js'
import {
  createNoteTagsService,
  normalizeTagName,
  type NoteAccessRepositoryContract,
  type NoteTagsRepositoryContract,
} from '../../src/modules/notes/services/note-tags.service.js'

const userId = new Types.ObjectId().toString()
const noteId = new Types.ObjectId().toString()
const tagId = new Types.ObjectId().toString()
const createdAt = new Date('2026-11-04T08:00:00.000Z')

const createRepository = (overrides: Partial<NoteTagsRepositoryContract> = {}): NoteTagsRepositoryContract => ({
  findTagsByUserId: async () => [],
  findTagByNormalizedName: async () => null,
  findTagById: async () => null,
  createTag: async (_userId, name, _normalizedName, color) => ({ _id: tagId, name, color, createdAt }),
  updateTag: async (_userId, _tagId, name, _normalizedName, color) => ({ _id: tagId, name, color, createdAt }),
  deleteTag: async () => null,
  findTagsByIds: async () => [],
  findTagAssignments: async () => [],
  findTagAssignmentsForNotes: async () => [],
  findNoteIdsWithAllTags: async () => [],
  replaceTagAssignments: async () => undefined,
  removeTagAssignment: async () => undefined,
  deleteAssignmentsForTag: async () => undefined,
  ...overrides,
})

const noteAccess: NoteAccessRepositoryContract = {
  getNoteAccess: async () => ({ note: { _id: noteId } }),
}

test('trims tag names and collapses consecutive internal whitespace', () => {
  assert.deepEqual(normalizeTagName('  Lập   trình\tWeb  '), {
    name: 'Lập trình Web',
    normalizedName: 'lập trình web',
  })
})

test('creates a personal tag with a normalized custom color', async () => {
  let receivedNormalizedName = ''
  const service = createNoteTagsService(createRepository({
    createTag: async (_userId, name, normalizedName, color) => {
      receivedNormalizedName = normalizedName
      return { _id: tagId, name, color, createdAt }
    },
  }), noteAccess)

  const tag = await service.createTag(userId, { name: '  Công   nghệ  ', color: '#7DA0CA' })

  assert.equal(receivedNormalizedName, 'công nghệ')
  assert.equal(tag.name, 'Công nghệ')
  assert.equal(tag.color, '#7da0ca')
})

test('rejects a duplicate tag name without case sensitivity', async () => {
  const service = createNoteTagsService(createRepository({
    findTagByNormalizedName: async () => ({ _id: tagId }),
  }), noteAccess)

  await assert.rejects(
    service.createTag(userId, { name: 'LẬP TRÌNH', color: '#548383' }),
    (error: unknown) => error instanceof AppError
      && error.code === 'NOTE_TAG_ALREADY_EXISTS'
      && error.fieldErrors?.name === 'Tên thẻ đã được sử dụng.',
  )
})

test('updates the name and color of an owned tag', async () => {
  const service = createNoteTagsService(createRepository({
    findTagById: async () => ({ _id: tagId, name: 'Cũ', color: '#4285f4', createdAt }),
  }), noteAccess)

  const tag = await service.updateTag(userId, tagId, { name: '  Học   kỳ  ', color: '#33B679' })

  assert.equal(tag.name, 'Học kỳ')
  assert.equal(tag.color, '#33b679')
})

test('deletes an owned tag and all of its personal assignments', async () => {
  let assignmentsDeleted = false
  const service = createNoteTagsService(createRepository({
    deleteTag: async () => ({ _id: tagId }),
    deleteAssignmentsForTag: async (_userId, removedTagId) => {
      assignmentsDeleted = removedTagId === tagId
    },
  }), noteAccess)

  await service.deleteTag(userId, tagId)

  assert.equal(assignmentsDeleted, true)
})

test('rejects more than ten tags on one note', async () => {
  const service = createNoteTagsService(createRepository(), noteAccess)
  const tagIds = Array.from({ length: 11 }, () => new Types.ObjectId().toString())

  await assert.rejects(
    service.setNoteTags(userId, noteId, { tagIds }),
    (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR',
  )
})

test('groups tags for a note list without loading tags once per note', async () => {
  const secondNoteId = new Types.ObjectId().toString()
  const secondTagId = new Types.ObjectId().toString()
  let bulkAssignmentQueries = 0
  const service = createNoteTagsService(createRepository({
    findTagAssignmentsForNotes: async (_userId, noteIds) => {
      bulkAssignmentQueries += 1
      assert.deepEqual(noteIds, [noteId, secondNoteId])
      return [
        { noteId, tagId },
        { noteId: secondNoteId, tagId: secondTagId },
      ]
    },
    findTagsByIds: async () => [
      { _id: tagId, name: 'ToÃ¡n', color: '#4285f4', createdAt },
      { _id: secondTagId, name: 'Lá»‹ch sá»­', color: '#d81b60', createdAt },
    ],
  }), noteAccess)

  const result = await service.getTagsForNotes(userId, [noteId, secondNoteId])

  assert.equal(bulkAssignmentQueries, 1)
  assert.deepEqual(result[noteId]?.map((tag) => tag.name), ['ToÃ¡n'])
  assert.deepEqual(result[secondNoteId]?.map((tag) => tag.name), ['Lá»‹ch sá»­'])
})

test('filters notes that contain every selected personal tag', async () => {
  const secondTagId = new Types.ObjectId().toString()
  let receivedTagIds: readonly string[] = []
  const service = createNoteTagsService(createRepository({
    findTagsByIds: async () => [
      { _id: tagId, name: 'Toán', color: '#4285f4', createdAt },
      { _id: secondTagId, name: 'Ôn thi', color: '#33b679', createdAt },
    ],
    findNoteIdsWithAllTags: async (_userId, tagIds) => {
      receivedTagIds = tagIds
      return [noteId]
    },
  }), noteAccess)

  const result = await service.resolveTagFilter(userId, [tagId, secondTagId])

  assert.deepEqual(receivedTagIds, [tagId, secondTagId])
  assert.deepEqual(result, { noteIds: [noteId], invalidTagIds: [] })
})
