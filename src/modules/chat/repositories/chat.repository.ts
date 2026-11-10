import { Types } from 'mongoose'

import { UserModel } from '@/modules/auth/models/user.model.js'
import { FriendshipModel } from '@/modules/chat/models/friendship.model.js'
import { UserBlockModel } from '@/modules/chat/models/user-block.model.js'
import type { ChatChannelItem } from '@/modules/chat/types/chat.types.js'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const chatRepository = {
  findChannelsByUserId: async (_userId: string): Promise<ChatChannelItem[]> => [],

  findActiveUserById: (userId: string) =>
    UserModel.findOne({ _id: userId, status: 'active' })
      .select('fullName username avatarUrl status')
      .lean(),

  findActiveUserByExactIdentifier: (identifier: string) =>
    UserModel.findOne({
      status: 'active',
      $or: [{ username: identifier }, { email: identifier }],
    })
      .select('fullName username avatarUrl status')
      .lean(),

  findActiveUsersByIds: (userIds: string[], query?: string, limit = 100) => {
    const filter: Record<string, unknown> = {
      _id: { $in: userIds.map((userId) => new Types.ObjectId(userId)) },
      status: 'active',
    }
    if (query) {
      const pattern = new RegExp(escapeRegex(query), 'iu')
      filter.$or = [{ username: pattern }, { email: pattern }]
    }
    return UserModel.find(filter)
      .select('fullName username avatarUrl status')
      .sort({ username: 1 })
      .limit(limit)
      .lean()
  },

  findUsersByIds: (userIds: string[]) =>
    UserModel.find({ _id: { $in: userIds.map((userId) => new Types.ObjectId(userId)) } })
      .select('fullName username avatarUrl status')
      .sort({ username: 1 })
      .lean(),

  findFriendshipByPair: (userAId: string, userBId: string) =>
    FriendshipModel.findOne({ userAId, userBId }).lean(),

  createFriendRequest: (userAId: string, userBId: string, requestedById: string) =>
    FriendshipModel.create({ userAId, userBId, requestedById, status: 'pending' }),

  findPendingRequestsForUser: (userId: string) =>
    FriendshipModel.find({
      status: 'pending',
      $or: [{ userAId: userId }, { userBId: userId }],
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean(),

  findAcceptedFriendshipsForUser: (userId: string) =>
    FriendshipModel.find({
      status: 'accepted',
      $or: [{ userAId: userId }, { userBId: userId }],
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean(),

  acceptFriendRequest: (requestId: string, userId: string) =>
    FriendshipModel.findOneAndUpdate(
      {
        _id: requestId,
        status: 'pending',
        requestedById: { $ne: userId },
        $or: [{ userAId: userId }, { userBId: userId }],
      },
      { $set: { status: 'accepted', acceptedAt: new Date() } },
      { new: true, runValidators: true },
    ).lean(),

  declineFriendRequest: (requestId: string, userId: string) =>
    FriendshipModel.findOneAndDelete({
      _id: requestId,
      status: 'pending',
      requestedById: { $ne: userId },
      $or: [{ userAId: userId }, { userBId: userId }],
    }).lean(),

  deleteRelationshipBetween: (userAId: string, userBId: string) =>
    FriendshipModel.deleteOne({ userAId, userBId }),

  findBlocksForUser: (userId: string) =>
    UserBlockModel.find({ $or: [{ blockerId: userId }, { blockedId: userId }] }).lean(),

  findBlocksByBlocker: (userId: string) =>
    UserBlockModel.find({ blockerId: userId }).sort({ createdAt: -1, _id: -1 }).lean(),

  findBlockBetween: (userAId: string, userBId: string) =>
    UserBlockModel.findOne({
      $or: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    }).lean(),

  upsertBlock: (blockerId: string, blockedId: string) =>
    UserBlockModel.findOneAndUpdate(
      { blockerId, blockedId },
      { $setOnInsert: { blockerId, blockedId } },
      { new: true, upsert: true, runValidators: true },
    ).lean(),

  deleteBlock: (blockerId: string, blockedId: string) =>
    UserBlockModel.deleteOne({ blockerId, blockedId }),
}
