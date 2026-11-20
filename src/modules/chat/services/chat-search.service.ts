import { AppError } from '@/shared/errors/app-error.js'
import {
  CHAT_SEARCH_MESSAGE_LIMIT,
  CHAT_SEARCH_QUERY_MAX_LENGTH,
} from '@/modules/chat/config/chat.config.js'
import {
  chatSearchRepository,
  type GroupMessageSearchAccess,
} from '@/modules/chat/repositories/chat-search.repository.js'
import type {
  ChatMessageSearchResult,
  ChatUserSummary,
} from '@/modules/chat/types/chat.types.js'

interface PersistedFriendship {
  _id: unknown
  userAId: unknown
  userBId: unknown
}

interface PersistedMembership {
  groupId: unknown
  joinedAt: Date
}

interface PersistedGroup {
  _id: unknown
  name: string
  historyVisibility: 'from_join' | 'all'
}

interface PersistedMessage {
  _id: unknown
  conversationId?: unknown
  groupId?: unknown
  senderId: unknown
  content: string
  createdAt?: Date
}

interface PersistedUser {
  _id: unknown
  fullName: string
  username: string
  avatarUrl?: string | null
}

export interface ChatSearchRepositoryContract {
  findAcceptedDirectConversations: (userId: string) => PromiseLike<unknown[]>
  findGroupMemberships: (userId: string) => PromiseLike<unknown[]>
  findActiveGroupsByIds: (groupIds: readonly string[]) => PromiseLike<unknown[]>
  findUsersByIds: (userIds: readonly string[]) => PromiseLike<unknown[]>
  searchDirectMessages: (conversationIds: readonly string[], query: string, limit: number) => PromiseLike<unknown[]>
  searchGroupMessages: (access: readonly GroupMessageSearchAccess[], query: string, limit: number) => PromiseLike<unknown[]>
}

const normalizeSearchQuery = (rawQuery: unknown): string => {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      query: 'Vui lòng nhập từ khóa tìm kiếm.',
    })
  }
  const query = rawQuery.trim()
  if (query.length > CHAT_SEARCH_QUERY_MAX_LENGTH) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      query: `Từ khóa không được vượt quá ${CHAT_SEARCH_QUERY_MAX_LENGTH} ký tự.`,
    })
  }
  return query
}

const otherUserId = (friendship: PersistedFriendship, userId: string): string =>
  String(friendship.userAId) === userId ? String(friendship.userBId) : String(friendship.userAId)

const toUserSummary = (rawUser: unknown): ChatUserSummary => {
  const user = rawUser as PersistedUser
  return {
    id: String(user._id),
    fullName: user.fullName,
    username: user.username,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
  }
}

export const createChatSearchService = (repository: ChatSearchRepositoryContract) => ({
  async searchMessages(userId: string, rawQuery: unknown): Promise<ChatMessageSearchResult[]> {
    const query = normalizeSearchQuery(rawQuery)
    const [rawConversations, rawMemberships] = await Promise.all([
      repository.findAcceptedDirectConversations(userId),
      repository.findGroupMemberships(userId),
    ])
    const conversations = rawConversations as PersistedFriendship[]
    const memberships = rawMemberships as PersistedMembership[]
    const groupIds = memberships.map((membership) => String(membership.groupId))
    const rawGroups = await repository.findActiveGroupsByIds(groupIds)
    const groups = rawGroups as PersistedGroup[]
    const groupsById = new Map(groups.map((group) => [String(group._id), group] as const))
    const membershipByGroupId = new Map(
      memberships.map((membership) => [String(membership.groupId), membership] as const),
    )
    const groupAccess: GroupMessageSearchAccess[] = groups.map((group) => {
      const membership = membershipByGroupId.get(String(group._id))
      return {
        groupId: String(group._id),
        ...(group.historyVisibility === 'from_join' && membership
          ? { visibleAfter: membership.joinedAt }
          : {}),
      }
    })

    const conversationIds = conversations.map((conversation) => String(conversation._id))
    const [rawDirectMessages, rawGroupMessages] = await Promise.all([
      repository.searchDirectMessages(conversationIds, query, CHAT_SEARCH_MESSAGE_LIMIT),
      repository.searchGroupMessages(groupAccess, query, CHAT_SEARCH_MESSAGE_LIMIT),
    ])
    const allMessages = [...rawDirectMessages, ...rawGroupMessages] as PersistedMessage[]
    const senderIds = [...new Set(allMessages.map((message) => String(message.senderId)))]
    const participantIds = conversations.map((conversation) => otherUserId(conversation, userId))
    const rawUsers = await repository.findUsersByIds([...new Set([...senderIds, ...participantIds])])
    const usersById = new Map(rawUsers.map((user) => {
      const summary = toUserSummary(user)
      return [summary.id, summary] as const
    }))
    const directNamesById = new Map(conversations.map((conversation) => [
      String(conversation._id),
      usersById.get(otherUserId(conversation, userId))?.fullName ?? 'Đoạn chat',
    ] as const))
    const deletedUser: ChatUserSummary = {
      id: 'deleted',
      fullName: 'Tài khoản không còn tồn tại',
      username: 'tai-khoan-da-xoa',
    }

    const results: ChatMessageSearchResult[] = []
    for (const message of allMessages) {
      if (!message.createdAt) continue
      const directConversationId = message.conversationId ? String(message.conversationId) : undefined
      const groupId = message.groupId ? String(message.groupId) : undefined
      if (directConversationId) {
        results.push({
          messageId: String(message._id),
          conversationId: directConversationId,
          conversationType: 'direct',
          conversationName: directNamesById.get(directConversationId) ?? 'Đoạn chat',
          content: message.content,
          sender: usersById.get(String(message.senderId)) ?? deletedUser,
          createdAt: message.createdAt.toISOString(),
        })
        continue
      }
      const group = groupId ? groupsById.get(groupId) : undefined
      if (groupId && group) results.push({
        messageId: String(message._id),
        conversationId: groupId,
        conversationType: 'group',
        conversationName: group.name,
        content: message.content,
        sender: usersById.get(String(message.senderId)) ?? deletedUser,
        createdAt: message.createdAt.toISOString(),
      })
    }

    return results
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, CHAT_SEARCH_MESSAGE_LIMIT)
  },
})

export const chatSearchService = createChatSearchService(chatSearchRepository)
