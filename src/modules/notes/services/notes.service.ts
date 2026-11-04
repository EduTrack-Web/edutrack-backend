import { isValidObjectId } from 'mongoose'

import { AppError } from '../../../shared/errors/app-error.js'
import {
  NOTE_BACKGROUND_VALUES,
  NOTE_DEFAULT_TITLE,
  NOTE_PURGE_BATCH_SIZE,
  NOTE_SEARCH_QUERY_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  NOTE_TRASH_RETENTION_MS,
  type NoteBackground,
} from '../config/notes.config.js'
import { notesRepository } from '../repositories/notes.repository.js'
import { noteTagsRepository } from '../repositories/note-tags.repository.js'
import { noteImageService } from './note-image.service.js'
import { noteSharesService, type ResolvedNoteAccess } from './note-shares.service.js'
import type { NoteAccess, NoteContentNode, NoteDetail, NoteSummary, TrashedNoteSummary } from '../types/notes.types.js'
import {
  createNoteContentPreview,
  extractNoteImagePublicIds,
  extractPlainText,
  validateNoteContent,
  validateNoteImageReferences,
} from '../validation/note-content.validation.js'

const emptyDocument: NoteContentNode = { type: 'doc', content: [{ type: 'paragraph' }] }

export interface PersistedNote {
  _id: unknown
  ownerId: unknown
  title: string
  content: unknown
  plainText: string
  background: NoteBackground
  version: number
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
  purgeAt?: Date | null
}

export interface NotesRepositoryContract {
  findNotesByUserId: (userId: string) => PromiseLike<unknown[]>
  findAccessibleNotes: (
    userId: string,
    sharedNoteIds: readonly string[],
    searchQuery: string,
    tagFilteredNoteIds?: readonly string[],
  ) => PromiseLike<unknown[]>
  findTrashedNotesByUserId: (userId: string) => PromiseLike<unknown[]>
  findOwnedNoteById: (userId: string, noteId: string) => PromiseLike<unknown | null>
  findActiveNoteById: (noteId: string) => PromiseLike<unknown | null>
  findOwnedTrashedNoteById: (userId: string, noteId: string) => PromiseLike<unknown | null>
  createNote: (userId: string, title: string, content: NoteContentNode) => PromiseLike<unknown>
  createDuplicatedNote: (
    userId: string,
    title: string,
    content: NoteContentNode,
    plainText: string,
    background: NoteBackground,
  ) => PromiseLike<unknown>
  deleteOwnedActiveNote: (userId: string, noteId: string) => PromiseLike<unknown | null>
  updateOwnedNote: (
    userId: string,
    noteId: string,
    update: { title: string; content: NoteContentNode; plainText: string; background?: NoteBackground },
  ) => PromiseLike<unknown | null>
  updateActiveNoteById: (
    noteId: string,
    update: { title: string; content: NoteContentNode; plainText: string; background?: NoteBackground },
  ) => PromiseLike<unknown | null>
  moveOwnedNoteToTrash: (userId: string, noteId: string, deletedAt: Date, purgeAt: Date) => PromiseLike<unknown | null>
  restoreOwnedNote: (userId: string, noteId: string) => PromiseLike<unknown | null>
  deleteOwnedTrashedNote: (userId: string, noteId: string) => PromiseLike<unknown | null>
  findExpiredTrashedNotes: (now: Date, limit: number) => PromiseLike<unknown[]>
  deleteExpiredTrashedNote: (noteId: string, now: Date) => PromiseLike<unknown | null>
}

export interface NoteImageCleanupContract {
  destroyMany: (publicIds: readonly string[]) => PromiseLike<void>
  duplicateContent: (content: NoteContentNode, userId: string) => PromiseLike<{
    content: NoteContentNode
    createdPublicIds: string[]
  }>
}

export interface NoteTagAssignmentContract {
  copyTagAssignments: (userId: string, sourceNoteId: string, targetNoteId: string) => PromiseLike<void>
  deleteAssignmentsForNote: (noteId: string) => PromiseLike<unknown>
}

export interface NoteAccessContract {
  getNoteAccess: (userId: string, noteId: string) => PromiseLike<ResolvedNoteAccess | null>
  getSharedNoteIds: (userId: string) => PromiseLike<string[]>
  getSharedAccessByNoteId: (userId: string) => PromiseLike<Record<string, NoteAccess>>
  deleteSharesForNote: (noteId: string) => PromiseLike<unknown>
}

const ownerAccess: NoteAccess = {
  role: 'owner',
  canEdit: true,
  canManageAccess: true,
  isSharedWithMe: false,
}

const toSummary = (note: PersistedNote, access: NoteAccess = ownerAccess): NoteSummary => {
  const content = validateNoteContent(note.content)
  return {
    id: String(note._id),
    title: note.title,
    preview: note.plainText.slice(0, 180),
    contentPreview: createNoteContentPreview(content),
    background: note.background ?? 'default',
    version: note.version,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    access,
  }
}

const toDetail = (note: PersistedNote, access: NoteAccess = ownerAccess): NoteDetail => ({
  ...toSummary(note, access),
  content: validateNoteContent(note.content),
})

const toTrashedSummary = (note: PersistedNote): TrashedNoteSummary => {
  if (!note.deletedAt || !note.purgeAt) {
    throw new AppError(500, 'INVALID_TRASH_STATE', 'Trạng thái thùng rác của ghi chú không hợp lệ.')
  }
  return {
    ...toSummary(note),
    deletedAt: note.deletedAt.toISOString(),
    purgeAt: note.purgeAt.toISOString(),
  }
}

const requireValidId = (noteId: string): void => {
  if (!isValidObjectId(noteId)) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
}

const normalizeTitle = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { title: 'Tiêu đề không hợp lệ.' })
  }
  const title = value.trim() || NOTE_DEFAULT_TITLE
  if (title.length > NOTE_TITLE_MAX_LENGTH) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      title: `Tiêu đề không được vượt quá ${NOTE_TITLE_MAX_LENGTH} ký tự.`,
    })
  }
  return title
}

const normalizeBackground = (value: unknown): NoteBackground | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !NOTE_BACKGROUND_VALUES.includes(value as NoteBackground)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      background: 'Màu nền ghi chú không hợp lệ.',
    })
  }
  return value as NoteBackground
}

const imagePublicIdsFrom = (note: PersistedNote): string[] =>
  extractNoteImagePublicIds(validateNoteContent(note.content))

const normalizeSearchQuery = (value: unknown): string => {
  if (value === undefined) return ''
  if (typeof value !== 'string') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Từ khóa tìm kiếm không hợp lệ.', {
      query: 'Từ khóa tìm kiếm không hợp lệ.',
    })
  }
  const query = value.trim().replace(/\s+/gu, ' ')
  if (query.length > NOTE_SEARCH_QUERY_MAX_LENGTH) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Từ khóa tìm kiếm không hợp lệ.', {
      query: `Từ khóa không được vượt quá ${NOTE_SEARCH_QUERY_MAX_LENGTH} ký tự.`,
    })
  }
  return query
}

const searchRelevance = (note: PersistedNote, query: string): number => {
  if (!query) return 0
  const normalizedQuery = query.toLocaleLowerCase('vi-VN')
  const title = note.title.toLocaleLowerCase('vi-VN')
  const plainText = note.plainText.toLocaleLowerCase('vi-VN')
  let score = title === normalizedQuery ? 400 : title.startsWith(normalizedQuery) ? 300 : title.includes(normalizedQuery) ? 200 : 0
  for (const term of normalizedQuery.split(' ').filter(Boolean)) {
    if (title.startsWith(term)) score += 30
    else if (title.includes(term)) score += 20
    else if (plainText.includes(term)) score += 10
  }
  return score
}

export const sortNotesBySearchRelevance = (
  notes: readonly PersistedNote[],
  query: string,
): PersistedNote[] => [...notes].sort((left, right) => {
  const relevanceDifference = searchRelevance(right, query) - searchRelevance(left, query)
  return relevanceDifference || right.updatedAt.getTime() - left.updatedAt.getTime()
})

export const createNotesService = (
  repository: NotesRepositoryContract,
  imageCleanup: NoteImageCleanupContract = noteImageService,
  tagAssignments: NoteTagAssignmentContract = noteTagsRepository,
  accessControl: NoteAccessContract = noteSharesService,
) => ({
  async getUserNotes(
    userId: string,
    rawQuery?: unknown,
    tagFilteredNoteIds?: readonly string[],
  ): Promise<NoteSummary[]> {
    const searchQuery = normalizeSearchQuery(rawQuery)
    const [sharedNoteIds, sharedAccessByNoteId] = await Promise.all([
      accessControl.getSharedNoteIds(userId),
      accessControl.getSharedAccessByNoteId(userId),
    ])
    if (tagFilteredNoteIds && tagFilteredNoteIds.length === 0) return []
    const rawNotes = await repository.findAccessibleNotes(userId, sharedNoteIds, searchQuery, tagFilteredNoteIds)
    const notes = sortNotesBySearchRelevance(rawNotes.map((note) => note as PersistedNote), searchQuery)
    return notes.map((note) => {
      const access = String(note.ownerId) === userId
        ? ownerAccess
        : sharedAccessByNoteId[String(note._id)] ?? {
          role: 'view',
          canEdit: false,
          canManageAccess: false,
          isSharedWithMe: true,
        }
      return toSummary(note, access)
    })
  },

  async createNote(userId: string): Promise<NoteDetail> {
    const note = await repository.createNote(userId, NOTE_DEFAULT_TITLE, emptyDocument)
    return toDetail(note as PersistedNote)
  },

  async duplicateNote(userId: string, noteId: string, input: unknown): Promise<NoteDetail> {
    requireValidId(noteId)
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const payload = input as Record<string, unknown>
    if (!Object.keys(payload).every((key) => key === 'language') || !['vi', 'en'].includes(String(payload.language))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { language: 'Ngôn ngữ không hợp lệ.' })
    }
    const resolved = await accessControl.getNoteAccess(userId, noteId)
    if (!resolved) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    const sourceNote = resolved.note as PersistedNote
    const sourceContent = validateNoteContent(sourceNote.content)
    const duplicatedImages = await imageCleanup.duplicateContent(sourceContent, userId)
    const prefix = payload.language === 'en' ? 'Copy of ' : 'Bản sao của '
    const title = `${prefix}${sourceNote.title}`.slice(0, NOTE_TITLE_MAX_LENGTH)
    let duplicated: unknown | null = null
    try {
      duplicated = await repository.createDuplicatedNote(
        userId,
        title,
        duplicatedImages.content,
        extractPlainText(duplicatedImages.content),
        sourceNote.background ?? 'default',
      )
      const duplicatedId = String((duplicated as PersistedNote)._id)
      await tagAssignments.copyTagAssignments(userId, noteId, duplicatedId)
      return toDetail(duplicated as PersistedNote)
    } catch (error) {
      if (duplicated) await repository.deleteOwnedActiveNote(userId, String((duplicated as PersistedNote)._id))
      await imageCleanup.destroyMany(duplicatedImages.createdPublicIds)
      throw error
    }
  },

  async getTrashedNotes(userId: string): Promise<TrashedNoteSummary[]> {
    const notes = await repository.findTrashedNotesByUserId(userId)
    return notes.map((note) => toTrashedSummary(note as PersistedNote))
  },

  async getNote(userId: string, noteId: string): Promise<NoteDetail> {
    requireValidId(noteId)
    const resolved = await accessControl.getNoteAccess(userId, noteId)
    if (!resolved) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    return toDetail(resolved.note as PersistedNote, resolved.access)
  },

  async updateNote(userId: string, noteId: string, input: unknown): Promise<NoteDetail> {
    requireValidId(noteId)
    const resolved = await accessControl.getNoteAccess(userId, noteId)
    if (!resolved) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    if (!resolved.access.canEdit) {
      throw new AppError(403, 'NOTE_EDIT_FORBIDDEN', 'Bạn chỉ có quyền xem ghi chú này.')
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const payload = input as Record<string, unknown>
    if (!Object.keys(payload).every((key) => ['title', 'content', 'background'].includes(key))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
    }
    const title = normalizeTitle(payload.title)
    const content = validateNoteContent(payload.content)
    const background = normalizeBackground(payload.background)
    const trustedPublicIds = new Set(imagePublicIdsFrom(resolved.note as PersistedNote))
    validateNoteImageReferences(content, userId, trustedPublicIds)
    const note = await repository.updateActiveNoteById(noteId, {
      title,
      content,
      plainText: extractPlainText(content),
      ...(background ? { background } : {}),
    })
    if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    return toDetail(note as PersistedNote, resolved.access)
  },

  async moveNoteToTrash(userId: string, noteId: string, now = new Date()): Promise<TrashedNoteSummary> {
    requireValidId(noteId)
    const purgeAt = new Date(now.getTime() + NOTE_TRASH_RETENTION_MS)
    const note = await repository.moveOwnedNoteToTrash(userId, noteId, now, purgeAt)
    if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    return toTrashedSummary(note as PersistedNote)
  },

  async restoreNote(userId: string, noteId: string): Promise<NoteDetail> {
    requireValidId(noteId)
    const note = await repository.restoreOwnedNote(userId, noteId)
    if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú trong thùng rác.')
    return toDetail(note as PersistedNote)
  },

  async deleteNotePermanently(userId: string, noteId: string): Promise<void> {
    requireValidId(noteId)
    const note = await repository.findOwnedTrashedNoteById(userId, noteId)
    if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú trong thùng rác.')
    await imageCleanup.destroyMany(imagePublicIdsFrom(note as PersistedNote))
    const deleted = await repository.deleteOwnedTrashedNote(userId, noteId)
    if (!deleted) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú trong thùng rác.')
    await tagAssignments.deleteAssignmentsForNote(noteId)
    await accessControl.deleteSharesForNote(noteId)
  },

  async purgeExpiredNotes(now = new Date()): Promise<{ deleted: number; failed: number }> {
    const expiredNotes = await repository.findExpiredTrashedNotes(now, NOTE_PURGE_BATCH_SIZE)
    let deleted = 0
    let failed = 0
    for (const rawNote of expiredNotes) {
      const note = rawNote as PersistedNote
      try {
        await imageCleanup.destroyMany(imagePublicIdsFrom(note))
        const removed = await repository.deleteExpiredTrashedNote(String(note._id), now)
        if (removed) {
          await tagAssignments.deleteAssignmentsForNote(String(note._id))
          await accessControl.deleteSharesForNote(String(note._id))
          deleted += 1
        }
      } catch {
        failed += 1
      }
    }
    return { deleted, failed }
  },
})

export const notesService = createNotesService(notesRepository)

