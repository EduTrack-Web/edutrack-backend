import { Types } from 'mongoose'

import { UserModel } from '../../auth/models/user.model.js'
import { NoteShareModel } from '../models/note-share.model.js'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const noteSharesRepository = {
  findShare: (noteId: string, userId: string) => NoteShareModel.findOne({ noteId, userId }).lean(),

  findSharedNoteIds: async (userId: string): Promise<string[]> => {
    const shares = await NoteShareModel.find({ userId }).select('noteId').lean()
    return shares.map((share) => String(share.noteId))
  },

  findSharesForUser: (userId: string) =>
    NoteShareModel.find({ userId }).select('noteId permission').lean(),

  findSharesByNoteId: (noteId: string) =>
    NoteShareModel.find({ noteId })
      .sort({ createdAt: 1 })
      .populate('userId', 'fullName username avatarUrl status')
      .lean(),

  searchActiveUsers: (query: string, excludedUserId: string, limit: number) => {
    const pattern = new RegExp(escapeRegex(query), 'iu')
    return UserModel.find({
      _id: { $ne: excludedUserId },
      status: 'active',
      $or: [{ username: pattern }, { email: pattern }, { fullName: pattern }],
    })
      .select('fullName username avatarUrl')
      .sort({ username: 1 })
      .limit(limit)
      .lean()
  },

  findActiveUserById: (userId: string) =>
    UserModel.findOne({ _id: userId, status: 'active' }).select('fullName username avatarUrl').lean(),

  findUserById: (userId: string) =>
    UserModel.findById(userId).select('fullName username avatarUrl').lean(),

  upsertShare: (noteId: string, userId: string, permission: 'view' | 'edit', grantedBy: string) =>
    NoteShareModel.findOneAndUpdate(
      { noteId, userId },
      { $set: { permission, grantedBy } },
      { new: true, upsert: true, runValidators: true },
    ).lean(),

  deleteShare: (noteId: string, userId: string) => NoteShareModel.deleteOne({ noteId, userId }),

  deleteSharesForNote: (noteId: string) => NoteShareModel.deleteMany({ noteId }),

  findNoteIdsWithAccessForUser: async (userId: string): Promise<Types.ObjectId[]> => {
    const shares = await NoteShareModel.find({ userId }).select('noteId').lean()
    return shares.map((share) => new Types.ObjectId(String(share.noteId)))
  },
}
