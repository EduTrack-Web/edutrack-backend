import { UserModel } from '@/modules/auth/models/user.model.js'
import { ChatGroupMemberModel } from '@/modules/chat/models/chat-group-member.model.js'
import { ChatGroupModel } from '@/modules/chat/models/chat-group.model.js'
import { ChatMessageModel } from '@/modules/chat/models/chat-message.model.js'
import { DirectChatMessageModel } from '@/modules/chat/models/direct-chat-message.model.js'
import { FriendshipModel } from '@/modules/chat/models/friendship.model.js'

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface GroupMessageSearchAccess {
  groupId: string
  visibleAfter?: Date
}

export const chatSearchRepository = {
  findAcceptedDirectConversations: (userId: string) =>
    FriendshipModel.find({
      status: 'accepted',
      $or: [{ userAId: userId }, { userBId: userId }],
    }).lean(),

  findGroupMemberships: (userId: string) =>
    ChatGroupMemberModel.find({ userId }).select('groupId joinedAt').lean(),

  findActiveGroupsByIds: (groupIds: readonly string[]) =>
    ChatGroupModel.find({ _id: { $in: groupIds }, status: 'active' })
      .select('name historyVisibility')
      .lean(),

  findUsersByIds: (userIds: readonly string[]) =>
    UserModel.find({ _id: { $in: userIds } })
      .select('fullName username avatarUrl')
      .lean(),

  searchDirectMessages: (conversationIds: readonly string[], query: string, limit: number) => {
    if (conversationIds.length === 0) return Promise.resolve([])
    return DirectChatMessageModel.find({
      conversationId: { $in: conversationIds },
      content: new RegExp(escapeRegex(query), 'iu'),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean()
  },

  searchGroupMessages: (access: readonly GroupMessageSearchAccess[], query: string, limit: number) => {
    if (access.length === 0) return Promise.resolve([])
    const visibilityFilters = access.map((item) => ({
      groupId: item.groupId,
      ...(item.visibleAfter ? { createdAt: { $gte: item.visibleAfter } } : {}),
    }))
    return ChatMessageModel.find({
      $and: [
        { $or: visibilityFilters },
        { content: new RegExp(escapeRegex(query), 'iu') },
      ],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean()
  },
}
