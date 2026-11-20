import { Types } from 'mongoose'

import { UserModel } from '@/modules/auth/models/user.model.js'
import { DirectChatMessageModel } from '@/modules/chat/models/direct-chat-message.model.js'
import { FriendshipModel } from '@/modules/chat/models/friendship.model.js'

interface MessageCursorFilter {
  createdAt: Date
  id: string
}

interface MessageHistoryFilter {
  conversationId: string
  $or?: Array<
    | { createdAt: { $lt: Date } }
    | { createdAt: Date; _id: { $lt: Types.ObjectId } }
    | { createdAt: Date; _id: { $lte: Types.ObjectId } }
  >
}

export const directConversationsRepository = {
  findAcceptedConversationsForUser: (userId: string) =>
    FriendshipModel.find({
      status: 'accepted',
      $or: [{ userAId: userId }, { userBId: userId }],
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean(),

  findAcceptedConversationById: (conversationId: string, userId: string) =>
    FriendshipModel.findOne({
      _id: conversationId,
      status: 'accepted',
      $or: [{ userAId: userId }, { userBId: userId }],
    }).lean(),

  findActiveUserById: (userId: string) =>
    UserModel.findOne({ _id: userId, status: 'active' })
      .select('fullName username avatarUrl lastActiveAt lastLoginAt')
      .lean(),

  findActiveUsersByIds: (userIds: readonly string[]) =>
    UserModel.find({ _id: { $in: userIds }, status: 'active' })
      .select('fullName username avatarUrl lastActiveAt lastLoginAt')
      .lean(),

  findUsersByIds: (userIds: readonly string[]) =>
    UserModel.find({ _id: { $in: userIds } })
      .select('fullName username avatarUrl')
      .lean(),

  findLatestMessagesByConversationIds: (conversationIds: readonly string[]) => {
    if (conversationIds.length === 0) return Promise.resolve([])
    return DirectChatMessageModel.aggregate([
      { $match: { conversationId: { $in: conversationIds.map((id) => new Types.ObjectId(id)) } } },
      { $sort: { createdAt: -1 as const, _id: -1 as const } },
      { $group: { _id: '$conversationId', message: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$message' } },
    ])
  },

  touchConversation: (conversationId: string, updatedAt: Date) =>
    FriendshipModel.updateOne(
      { _id: conversationId, status: 'accepted' },
      { $set: { updatedAt } },
    ),

  findMessages: (
    conversationId: string,
    options: { cursor?: MessageCursorFilter; anchor?: MessageCursorFilter; limit: number },
  ) => {
    const filter: MessageHistoryFilter = { conversationId }
    if (options.cursor) {
      filter.$or = [
        { createdAt: { $lt: options.cursor.createdAt } },
        {
          createdAt: options.cursor.createdAt,
          _id: { $lt: new Types.ObjectId(options.cursor.id) },
        },
      ]
    }
    if (options.anchor) {
      filter.$or = [
        { createdAt: { $lt: options.anchor.createdAt } },
        {
          createdAt: options.anchor.createdAt,
          _id: { $lte: new Types.ObjectId(options.anchor.id) },
        },
      ]
    }
    return DirectChatMessageModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(options.limit)
      .lean()
  },

  findMessageById: (conversationId: string, messageId: string) =>
    DirectChatMessageModel.findOne({ _id: messageId, conversationId }).lean(),

  createMessage: (input: {
    conversationId: string
    senderId: string
    clientMessageId: string
    content: string
  }) => DirectChatMessageModel.create(input),

  findByClientMessageId: (conversationId: string, senderId: string, clientMessageId: string) =>
    DirectChatMessageModel.findOne({ conversationId, senderId, clientMessageId }).lean(),
}
