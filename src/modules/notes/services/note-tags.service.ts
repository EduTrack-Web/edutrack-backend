import { isValidObjectId } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import {
  NOTE_TAG_COLOR_PATTERN,
  NOTE_TAG_DEFAULT_COLOR,
  NOTE_TAG_MAX_PER_NOTE,
  NOTE_TAG_NAME_MAX_LENGTH,
} from '@/modules/notes/config/notes.config.js'
import { noteTagsRepository } from '@/modules/notes/repositories/note-tags.repository.js'
import { noteSharesService } from '@/modules/notes/services/note-shares.service.js'
import type { NoteTag } from '@/modules/notes/types/notes.types.js'

interface PersistedTag {
  _id: unknown
  name: string
  color: string
  createdAt: Date
}

export interface NoteTagsRepositoryContract {
  findTagsByUserId: (userId: string) => PromiseLike<unknown[]>
  findTagByNormalizedName: (userId: string, normalizedName: string) => PromiseLike<unknown | null>
  findTagById: (userId: string, tagId: string) => PromiseLike<unknown | null>
  createTag: (userId: string, name: string, normalizedName: string, color: string) => PromiseLike<unknown>
  updateTag: (
    userId: string,
    tagId: string,
    name: string,
    normalizedName: string,
    color: string,
  ) => PromiseLike<unknown | null>
  deleteTag: (userId: string, tagId: string) => PromiseLike<unknown | null>
  findTagsByIds: (userId: string, tagIds: readonly string[]) => PromiseLike<unknown[]>
  findTagAssignments: (userId: string, noteId: string) => PromiseLike<Array<{ tagId: unknown }>>
  findTagAssignmentsForNotes: (
    userId: string,
    noteIds: readonly string[],
  ) => PromiseLike<Array<{ noteId: unknown; tagId: unknown }>>
  findNoteIdsWithAllTags: (userId: string, tagIds: readonly string[]) => PromiseLike<string[]>
  replaceTagAssignments: (userId: string, noteId: string, tagIds: readonly string[]) => PromiseLike<void>
  removeTagAssignment: (userId: string, noteId: string, tagId: string) => PromiseLike<unknown>
  deleteAssignmentsForTag: (userId: string, tagId: string) => PromiseLike<unknown>
}

export interface NoteAccessRepositoryContract {
  getNoteAccess: (userId: string, noteId: string) => PromiseLike<unknown | null>
}

const toTag = (tag: PersistedTag): NoteTag => ({
  id: String(tag._id),
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt.toISOString(),
})

const requireValidNoteId = (noteId: string): void => {
  if (!isValidObjectId(noteId)) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
}

const requireNoteAccess = async (
  repository: NoteAccessRepositoryContract,
  userId: string,
  noteId: string,
): Promise<void> => {
  requireValidNoteId(noteId)
  if (!await repository.getNoteAccess(userId, noteId)) {
    throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
  }
}

export const normalizeTagName = (value: unknown): { name: string; normalizedName: string } => {
  if (typeof value !== 'string') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { name: 'Tên thẻ không hợp lệ.' })
  }
  const name = value.trim().replace(/\s+/gu, ' ')
  if (!name) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { name: 'Vui lòng nhập tên thẻ.' })
  }
  if (name.length > NOTE_TAG_NAME_MAX_LENGTH) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      name: `Tên thẻ không được vượt quá ${NOTE_TAG_NAME_MAX_LENGTH} ký tự.`,
    })
  }
  return { name, normalizedName: name.toLocaleLowerCase('vi-VN') }
}

const normalizeTagColor = (value: unknown): string => {
  if (value === undefined) return NOTE_TAG_DEFAULT_COLOR
  if (typeof value !== 'string' || !NOTE_TAG_COLOR_PATTERN.test(value)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      color: 'Màu thẻ phải là mã màu HEX gồm 6 ký tự.',
    })
  }
  return value.toLowerCase()
}

const normalizeTagIds = (input: unknown): string[] => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  }
  const payload = input as Record<string, unknown>
  if (!Object.keys(payload).every((key) => key === 'tagIds') || !Array.isArray(payload.tagIds)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { tagIds: 'Danh sách thẻ không hợp lệ.' })
  }
  const tagIds = [...new Set(payload.tagIds)]
  if (tagIds.length > NOTE_TAG_MAX_PER_NOTE) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      tagIds: `Mỗi ghi chú chỉ được gắn tối đa ${NOTE_TAG_MAX_PER_NOTE} thẻ.`,
    })
  }
  if (!tagIds.every((tagId): tagId is string => typeof tagId === 'string' && isValidObjectId(tagId))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { tagIds: 'Danh sách thẻ không hợp lệ.' })
  }
  return tagIds
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000

export const createNoteTagsService = (
  repository: NoteTagsRepositoryContract,
  noteAccess: NoteAccessRepositoryContract,
) => ({
  async getUserTags(userId: string): Promise<NoteTag[]> {
    const tags = await repository.findTagsByUserId(userId)
    return tags.map((tag) => toTag(tag as PersistedTag))
  },

  async createTag(userId: string, input: unknown): Promise<NoteTag> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const payload = input as Record<string, unknown>
    if (!Object.keys(payload).every((key) => ['name', 'color'].includes(key))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const { name, normalizedName } = normalizeTagName(payload.name)
    const color = normalizeTagColor(payload.color)
    if (await repository.findTagByNormalizedName(userId, normalizedName)) {
      throw new AppError(409, 'NOTE_TAG_ALREADY_EXISTS', 'Thẻ này đã tồn tại.', { name: 'Tên thẻ đã được sử dụng.' })
    }
    try {
      return toTag(await repository.createTag(userId, name, normalizedName, color) as PersistedTag)
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError(409, 'NOTE_TAG_ALREADY_EXISTS', 'Thẻ này đã tồn tại.', { name: 'Tên thẻ đã được sử dụng.' })
      }
      throw error
    }
  },

  async updateTag(userId: string, tagId: string, input: unknown): Promise<NoteTag> {
    if (!isValidObjectId(tagId)) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const payload = input as Record<string, unknown>
    if (!Object.keys(payload).every((key) => ['name', 'color'].includes(key))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const currentTag = await repository.findTagById(userId, tagId)
    if (!currentTag) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
    const { name, normalizedName } = normalizeTagName(payload.name)
    const color = normalizeTagColor(payload.color)
    const duplicate = await repository.findTagByNormalizedName(userId, normalizedName)
    if (duplicate && String((duplicate as PersistedTag)._id) !== tagId) {
      throw new AppError(409, 'NOTE_TAG_ALREADY_EXISTS', 'Thẻ này đã tồn tại.', {
        name: 'Tên thẻ đã được sử dụng.',
      })
    }
    try {
      const updated = await repository.updateTag(userId, tagId, name, normalizedName, color)
      if (!updated) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
      return toTag(updated as PersistedTag)
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppError(409, 'NOTE_TAG_ALREADY_EXISTS', 'Thẻ này đã tồn tại.', {
          name: 'Tên thẻ đã được sử dụng.',
        })
      }
      throw error
    }
  },

  async deleteTag(userId: string, tagId: string): Promise<void> {
    if (!isValidObjectId(tagId)) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
    const deleted = await repository.deleteTag(userId, tagId)
    if (!deleted) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
    await repository.deleteAssignmentsForTag(userId, tagId)
  },

  async getNoteTags(userId: string, noteId: string): Promise<NoteTag[]> {
    await requireNoteAccess(noteAccess, userId, noteId)
    const assignments = await repository.findTagAssignments(userId, noteId)
    const tagIds = assignments.map((assignment) => String(assignment.tagId))
    const tags = await repository.findTagsByIds(userId, tagIds)
    return tags.map((tag) => toTag(tag as PersistedTag))
  },

  async getTagsForNotes(userId: string, noteIds: readonly string[]): Promise<Record<string, NoteTag[]>> {
    const tagsByNoteId = Object.fromEntries(noteIds.map((noteId) => [noteId, [] as NoteTag[]]))
    if (noteIds.length === 0) return tagsByNoteId

    const assignments = await repository.findTagAssignmentsForNotes(userId, noteIds)
    const tagIds = [...new Set(assignments.map((assignment) => String(assignment.tagId)))]
    const tags = await repository.findTagsByIds(userId, tagIds)
    const tagsById = new Map(tags.map((tag) => {
      const persistedTag = tag as PersistedTag
      return [String(persistedTag._id), toTag(persistedTag)]
    }))

    for (const assignment of assignments) {
      const noteId = String(assignment.noteId)
      const tag = tagsById.get(String(assignment.tagId))
      if (tag && tagsByNoteId[noteId]) tagsByNoteId[noteId].push(tag)
    }
    for (const noteTags of Object.values(tagsByNoteId)) {
      noteTags.sort((left, right) => left.name.localeCompare(right.name, 'vi'))
    }
    return tagsByNoteId
  },

  async resolveTagFilter(userId: string, rawTagIds: readonly string[]): Promise<{
    noteIds: string[] | undefined
    invalidTagIds: string[]
  }> {
    const uniqueTagIds = [...new Set(rawTagIds)]
    if (uniqueTagIds.length === 0) return { noteIds: undefined, invalidTagIds: [] }
    if (uniqueTagIds.length > NOTE_TAG_MAX_PER_NOTE
      || !uniqueTagIds.every((tagId) => isValidObjectId(tagId))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Bộ lọc thẻ không hợp lệ.', {
        tagIds: 'Bộ lọc thẻ không hợp lệ.',
      })
    }
    const tags = await repository.findTagsByIds(userId, uniqueTagIds)
    const validTagIds = tags.map((tag) => String((tag as PersistedTag)._id))
    const validTagIdSet = new Set(validTagIds)
    const invalidTagIds = uniqueTagIds.filter((tagId) => !validTagIdSet.has(tagId))
    if (validTagIds.length === 0) return { noteIds: undefined, invalidTagIds }
    return {
      noteIds: await repository.findNoteIdsWithAllTags(userId, validTagIds),
      invalidTagIds,
    }
  },

  async setNoteTags(userId: string, noteId: string, input: unknown): Promise<NoteTag[]> {
    await requireNoteAccess(noteAccess, userId, noteId)
    const tagIds = normalizeTagIds(input)
    const tags = await repository.findTagsByIds(userId, tagIds)
    if (tags.length !== tagIds.length) {
      throw new AppError(422, 'NOTE_TAG_NOT_FOUND', 'Một hoặc nhiều thẻ không còn tồn tại.', {
        tagIds: 'Một hoặc nhiều thẻ không còn tồn tại.',
      })
    }
    await repository.replaceTagAssignments(userId, noteId, tagIds)
    return tags.map((tag) => toTag(tag as PersistedTag))
  },

  async removeNoteTag(userId: string, noteId: string, tagId: string): Promise<void> {
    await requireNoteAccess(noteAccess, userId, noteId)
    if (!isValidObjectId(tagId)) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
    const tags = await repository.findTagsByIds(userId, [tagId])
    if (tags.length !== 1) throw new AppError(404, 'NOTE_TAG_NOT_FOUND', 'Không tìm thấy thẻ.')
    await repository.removeTagAssignment(userId, noteId, tagId)
  },
})

export const noteTagsService = createNoteTagsService(noteTagsRepository, noteSharesService)
