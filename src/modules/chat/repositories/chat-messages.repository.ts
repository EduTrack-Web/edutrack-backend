import { Types } from 'mongoose'

import { UserModel } from '@/modules/auth/models/user.model.js'
import { ChatGroupMemberModel } from '@/modules/chat/models/chat-group-member.model.js'
import { ChatGroupModel } from '@/modules/chat/models/chat-group.model.js'
import { ChatMessageModel } from '@/modules/chat/models/chat-message.model.js'

interface MessageCursorFilter {
  createdAt: Date
  id: string
}

interface MessageHistoryFilter {
  groupId: string
  createdAt?: Date | { $gte: Date }
  $or?: Array<
    | { createdAt: { $lt: Date } }
    | { createdAt: Date; _id: { $lt: Types.ObjectId } }
    | { createdAt: Date; _id: { $lte: Types.ObjectId } }
  >
}

export const chatMessagesRepository = {
  findActiveGroupById: (groupId: string) =>
    ChatGroupModel.findOne({ _id: groupId, status: 'active' }).lean(),

  findMembership: (groupId: string, userId: string) =>
    ChatGroupMemberModel.findOne({ groupId, userId }).lean(),

  findActiveUserById: (userId: string) =>
    UserModel.findOne({ _id: userId, status: 'active' }).select('fullName username avatarUrl').lean(),

  findUsersByIds: (userIds: readonly string[]) =>
    UserModel.find({ _id: { $in: userIds } })
      .select('fullName username avatarUrl')
      .lean(),

  findMessages: (
    groupId: string,
    options: { visibleAfter?: Date; cursor?: MessageCursorFilter; anchor?: MessageCursorFilter; limit: number },
  ) => {
    const filter: MessageHistoryFilter = { groupId }
    if (options.visibleAfter) filter.createdAt = { $gte: options.visibleAfter }
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
    return ChatMessageModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(options.limit)
      .lean()
  },

  findMessageById: (groupId: string, messageId: string, visibleAfter?: Date) =>
    ChatMessageModel.findOne({
      _id: messageId,
      groupId,
      ...(visibleAfter ? { createdAt: { $gte: visibleAfter } } : {}),
    }).lean(),

  createMessage: (input: {
    groupId: string
    senderId: string
    clientMessageId: string
    content: string
  }) => ChatMessageModel.create(input),

  findByClientMessageId: (groupId: string, senderId: string, clientMessageId: string) =>
    ChatMessageModel.findOne({ groupId, senderId, clientMessageId }).lean(),

  touchGroup: (groupId: string, activityAt: Date) =>
    ChatGroupModel.updateOne(
      { _id: groupId, status: 'active' },
      { $max: { updatedAt: activityAt } },
      { timestamps: false },
    ),
}
