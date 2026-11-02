import { isValidObjectId } from 'mongoose'

import { AppError } from '../../../shared/errors/app-error.js'
import {
  NOTE_BACKGROUND_VALUES,
  NOTE_DEFAULT_TITLE,
  NOTE_TITLE_MAX_LENGTH,
  type NoteBackground,
} from '../config/notes.config.js'
import { notesRepository } from '../repositories/notes.repository.js'
import type { NoteContentNode, NoteDetail, NoteSummary } from '../types/notes.types.js'
import {
  createNoteContentPreview,
  extractPlainText,
  validateNoteContent,
  validateNoteImageReferences,
} from '../validation/note-content.validation.js'

const emptyDocument: NoteContentNode = { type: 'doc', content: [{ type: 'paragraph' }] }

export interface PersistedNote {
  _id: unknown
  title: string
  content: unknown
  plainText: string
  background: NoteBackground
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface NotesRepositoryContract {
  findNotesByUserId: (userId: string) => PromiseLike<unknown[]>
  findOwnedNoteById: (userId: string, noteId: string) => PromiseLike<unknown | null>
  createNote: (userId: string, title: string, content: NoteContentNode) => PromiseLike<unknown>
  updateOwnedNote: (
    userId: string,
    noteId: string,
    update: { title: string; content: NoteContentNode; plainText: string; background?: NoteBackground },
  ) => PromiseLike<unknown | null>
}

const toSummary = (note: PersistedNote): NoteSummary => {
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
  }
}

const toDetail = (note: PersistedNote): NoteDetail => ({
  ...toSummary(note),
  content: validateNoteContent(note.content),
})

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

export const createNotesService = (repository: NotesRepositoryContract) => ({
  async getUserNotes(userId: string): Promise<NoteSummary[]> {
    const notes = await repository.findNotesByUserId(userId)
    return notes.map((note) => toSummary(note as PersistedNote))
  },

  async createNote(userId: string): Promise<NoteDetail> {
    const note = await repository.createNote(userId, NOTE_DEFAULT_TITLE, emptyDocument)
    return toDetail(note as PersistedNote)
  },

  async getNote(userId: string, noteId: string): Promise<NoteDetail> {
    requireValidId(noteId)
    const note = await repository.findOwnedNoteById(userId, noteId)
    if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    return toDetail(note as PersistedNote)
  },

  async updateNote(userId: string, noteId: string, input: unknown): Promise<NoteDetail> {
    requireValidId(noteId)
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
    validateNoteImageReferences(content, userId)
    const note = await repository.updateOwnedNote(userId, noteId, {
      title,
      content,
      plainText: extractPlainText(content),
      ...(background ? { background } : {}),
    })
    if (!note) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    return toDetail(note as PersistedNote)
  },
})

export const notesService = createNotesService(notesRepository)

