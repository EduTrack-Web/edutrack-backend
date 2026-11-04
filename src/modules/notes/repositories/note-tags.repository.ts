import { Types } from 'mongoose'

import { NoteTagAssignmentModel } from '../models/note-tag-assignment.model.js'
import { NoteTagModel } from '../models/note-tag.model.js'

export const noteTagsRepository = {
  findTagsByUserId: (userId: string) =>
    NoteTagModel.find({ ownerId: userId }).sort({ name: 1 }).lean(),

  findTagByNormalizedName: (userId: string, normalizedName: string) =>
    NoteTagModel.findOne({ ownerId: userId, normalizedName }),

  findTagById: (userId: string, tagId: string) =>
    NoteTagModel.findOne({ _id: tagId, ownerId: userId }),

  createTag: (userId: string, name: string, normalizedName: string, color: string) =>
    NoteTagModel.create({ ownerId: userId, name, normalizedName, color }),

  updateTag: (userId: string, tagId: string, name: string, normalizedName: string, color: string) =>
    NoteTagModel.findOneAndUpdate(
      { _id: tagId, ownerId: userId },
      { $set: { name, normalizedName, color } },
      { new: true, runValidators: true },
    ),

  deleteTag: (userId: string, tagId: string) =>
    NoteTagModel.findOneAndDelete({ _id: tagId, ownerId: userId }),

  findTagsByIds: (userId: string, tagIds: readonly string[]) =>
    NoteTagModel.find({ ownerId: userId, _id: { $in: tagIds } }).lean(),

  findTagAssignments: (userId: string, noteId: string) =>
    NoteTagAssignmentModel.find({ userId, noteId }).lean(),

  findTagAssignmentsForNotes: (userId: string, noteIds: readonly string[]) =>
    NoteTagAssignmentModel.find({ userId, noteId: { $in: noteIds } }).lean(),

  findNoteIdsWithAllTags: async (userId: string, tagIds: readonly string[]): Promise<string[]> => {
    if (tagIds.length === 0) return []
    const rows = await NoteTagAssignmentModel.aggregate<{ _id: Types.ObjectId }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          tagId: { $in: tagIds.map((tagId) => new Types.ObjectId(tagId)) },
        },
      },
      { $group: { _id: '$noteId', tagCount: { $sum: 1 } } },
      { $match: { tagCount: tagIds.length } },
    ])
    return rows.map((row) => String(row._id))
  },

  replaceTagAssignments: async (userId: string, noteId: string, tagIds: readonly string[]) => {
    await NoteTagAssignmentModel.deleteMany({ userId, noteId })
    if (tagIds.length > 0) {
      await NoteTagAssignmentModel.insertMany(tagIds.map((tagId) => ({ userId, noteId, tagId })))
    }
  },

  removeTagAssignment: (userId: string, noteId: string, tagId: string) =>
    NoteTagAssignmentModel.deleteOne({ userId, noteId, tagId }),

  copyTagAssignments: async (userId: string, sourceNoteId: string, targetNoteId: string) => {
    const assignments = await NoteTagAssignmentModel.find({ userId, noteId: sourceNoteId }).lean()
    if (assignments.length > 0) {
      await NoteTagAssignmentModel.insertMany(assignments.map((assignment) => ({
        userId,
        noteId: targetNoteId,
        tagId: assignment.tagId,
      })))
    }
  },

  deleteAssignmentsForNote: (noteId: string) => NoteTagAssignmentModel.deleteMany({ noteId }),

  deleteAssignmentsForTag: (userId: string, tagId: string) =>
    NoteTagAssignmentModel.deleteMany({ userId, tagId }),
}
