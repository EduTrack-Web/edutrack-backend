import { NoteModel } from '../models/note.model.js'
import type { NoteBackground } from '../config/notes.config.js'
import type { NoteContentNode } from '../types/notes.types.js'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const notesRepository = {
  findNotesByUserId: (userId: string) =>
    NoteModel.find({ ownerId: userId, deletedAt: null }).sort({ updatedAt: -1 }).lean(),

  findAccessibleNotes: (
    userId: string,
    sharedNoteIds: readonly string[],
    searchQuery: string,
    tagFilteredNoteIds?: readonly string[],
  ) => {
    const accessFilter = sharedNoteIds.length > 0
      ? { $or: [{ ownerId: userId }, { _id: { $in: sharedNoteIds } }] }
      : { ownerId: userId }
    const filters: Record<string, unknown>[] = [accessFilter, { deletedAt: null }]
    if (searchQuery) {
      for (const term of searchQuery.split(' ').filter(Boolean)) {
        const pattern = new RegExp(escapeRegex(term), 'iu')
        filters.push({ $or: [{ title: pattern }, { plainText: pattern }] })
      }
    }
    if (tagFilteredNoteIds) filters.push({ _id: { $in: tagFilteredNoteIds } })

    return NoteModel.find({ $and: filters }).sort({ updatedAt: -1 }).lean()
  },

  findTrashedNotesByUserId: (userId: string) =>
    NoteModel.find({ ownerId: userId, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).lean(),

  findOwnedNoteById: (userId: string, noteId: string) =>
    NoteModel.findOne({ _id: noteId, ownerId: userId, deletedAt: null }),

  findActiveNoteById: (noteId: string) =>
    NoteModel.findOne({ _id: noteId, deletedAt: null }),

  findOwnedTrashedNoteById: (userId: string, noteId: string) =>
    NoteModel.findOne({ _id: noteId, ownerId: userId, deletedAt: { $ne: null } }),

  createNote: (userId: string, title: string, content: NoteContentNode) =>
    NoteModel.create({ ownerId: userId, title, content, plainText: '' }),

  createDuplicatedNote: (
    userId: string,
    title: string,
    content: NoteContentNode,
    plainText: string,
    background: NoteBackground,
  ) => NoteModel.create({ ownerId: userId, title, content, plainText, background }),

  deleteOwnedActiveNote: (userId: string, noteId: string) =>
    NoteModel.findOneAndDelete({ _id: noteId, ownerId: userId, deletedAt: null }),

  updateOwnedNote: (
    userId: string,
    noteId: string,
    update: { title: string; content: NoteContentNode; plainText: string; background?: NoteBackground },
  ) => NoteModel.findOneAndUpdate(
    { _id: noteId, ownerId: userId, deletedAt: null },
    { $set: update, $inc: { version: 1 } },
    { new: true, runValidators: true },
  ),

  updateActiveNoteById: (
    noteId: string,
    update: { title: string; content: NoteContentNode; plainText: string; background?: NoteBackground },
  ) => NoteModel.findOneAndUpdate(
    { _id: noteId, deletedAt: null },
    { $set: update, $inc: { version: 1 } },
    { new: true, runValidators: true },
  ),

  moveOwnedNoteToTrash: (userId: string, noteId: string, deletedAt: Date, purgeAt: Date) =>
    NoteModel.findOneAndUpdate(
      { _id: noteId, ownerId: userId, deletedAt: null },
      { $set: { deletedAt, purgeAt } },
      { new: true, runValidators: true },
    ),

  restoreOwnedNote: (userId: string, noteId: string) =>
    NoteModel.findOneAndUpdate(
      { _id: noteId, ownerId: userId, deletedAt: { $ne: null } },
      { $set: { deletedAt: null, purgeAt: null } },
      { new: true, runValidators: true },
    ),

  deleteOwnedTrashedNote: (userId: string, noteId: string) =>
    NoteModel.findOneAndDelete({ _id: noteId, ownerId: userId, deletedAt: { $ne: null } }),

  findExpiredTrashedNotes: (now: Date, limit: number) =>
    NoteModel.find({ deletedAt: { $ne: null }, purgeAt: { $lte: now } })
      .sort({ purgeAt: 1 })
      .limit(limit)
      .lean(),

  deleteExpiredTrashedNote: (noteId: string, now: Date) =>
    NoteModel.findOneAndDelete({ _id: noteId, deletedAt: { $ne: null }, purgeAt: { $lte: now } }),
}

