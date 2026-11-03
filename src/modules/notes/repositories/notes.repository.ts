import { NoteModel } from '../models/note.model.js'
import type { NoteBackground } from '../config/notes.config.js'
import type { NoteContentNode } from '../types/notes.types.js'

export const notesRepository = {
  findNotesByUserId: (userId: string) =>
    NoteModel.find({ ownerId: userId }).sort({ updatedAt: -1 }).lean(),

  findOwnedNoteById: (userId: string, noteId: string) =>
    NoteModel.findOne({ _id: noteId, ownerId: userId }),

  createNote: (userId: string, title: string, content: NoteContentNode) =>
    NoteModel.create({ ownerId: userId, title, content, plainText: '' }),

  updateOwnedNote: (
    userId: string,
    noteId: string,
    update: { title: string; content: NoteContentNode; plainText: string; background?: NoteBackground },
  ) => NoteModel.findOneAndUpdate(
    { _id: noteId, ownerId: userId },
    { $set: update, $inc: { version: 1 } },
    { new: true, runValidators: true },
  ),
}

