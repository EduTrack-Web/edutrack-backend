import { Buffer } from 'node:buffer'

import { isValidObjectId } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/modules/chat/config/chat.config.js'
import { directConversationsRepository } from '@/modules/chat/repositories/direct-conversations.repository.js'
import type {
  ChatConversationLastMessage,
  ChatUserSummary,
  DirectChatMessageItem,
  DirectChatMessagePage,
  DirectConversationSummary,
} from '@/modules/chat/types/chat.types.js'
import {
  validateCreateChatMessage,
  type CreateChatMessageInput,
} from '@/modules/chat/validations/chat-messages.validation.js'

interface PersistedFriendship {
  _id: unknown
  userAId: unknown
  userBId: unknown
  createdAt?: Date
  updatedAt?: Date
}

interface PersistedMessage {
  _id: unknown
  conversationId: unknown
  senderId: unknown
  clientMessageId: string
  content: string
  createdAt?: Date
}

interface PersistedUser {
  _id: unknown
  fullName: string
  username: string
  avatarUrl?: string | null
  lastActiveAt?: Date
  lastLoginAt?: Date
}

interface MessageCursor {
  createdAt: Date
  id: string
}

export interface DirectConversationsRepositoryContract {
  findAcceptedConversationsForUser: (userId: string) => PromiseLike<unknown[]>
  findAcceptedConversationById: (conversationId: string, userId: string) => PromiseLike<unknown | null>
  findActiveUserById: (userId: string) => PromiseLike<unknown | null>
  findActiveUsersByIds: (userIds: readonly string[]) => PromiseLike<unknown[]>
  findUsersByIds: (userIds: readonly string[]) => PromiseLike<unknown[]>
  findLatestMessagesByConversationIds: (conversationIds: readonly string[]) => PromiseLike<unknown[]>
  touchConversation: (conversationId: string, updatedAt: Date) => PromiseLike<unknown>
  findMessages: (
    conversationId: string,
    options: { cursor?: MessageCursor; anchor?: MessageCursor; limit: number },
  ) => PromiseLike<unknown[]>
  findMessageById: (conversationId: string, messageId: string) => PromiseLike<unknown | null>
  createMessage: (input: {
    conversationId: string
    senderId: string
    clientMessageId: string
    content: string
  }) => PromiseLike<unknown>
  findByClientMessageId: (
    conversationId: string,
    senderId: string,
    clientMessageId: string,
  ) => PromiseLike<unknown | null>
}

const requireConversationId = (conversationId: string): void => {
  if (!isValidObjectId(conversationId)) {
    throw new AppError(404, 'DIRECT_CONVERSATION_NOT_FOUND', 'Không tìm thấy cuộc trò chuyện.')
  }
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

const toConversationSummary = (
  friendship: PersistedFriendship,
  participant: ChatUserSummary,
  rawParticipant: unknown,
  lastMessage?: ChatConversationLastMessage,
): DirectConversationSummary => ({
  id: String(friendship._id),
  participant: {
    ...participant,
    isOnline: false,
    ...((rawParticipant as PersistedUser).lastActiveAt || (rawParticipant as PersistedUser).lastLoginAt
      ? { lastActiveAt: ((rawParticipant as PersistedUser).lastActiveAt
        ?? (rawParticipant as PersistedUser).lastLoginAt)!.toISOString() }
      : {}),
  },
  ...(lastMessage ? { lastMessage } : {}),
  createdAt: friendship.createdAt?.toISOString() ?? new Date(0).toISOString(),
  updatedAt: friendship.updatedAt?.toISOString()
    ?? friendship.createdAt?.toISOString()
    ?? new Date(0).toISOString(),
})

const toLastMessageSummary = (
  message: PersistedMessage,
  sender: ChatUserSummary | undefined,
  currentUserId: string,
): ChatConversationLastMessage | undefined => {
  if (!message.createdAt) return undefined
  const senderId = String(message.senderId)
  return {
    id: String(message._id),
    content: message.content,
    sender: sender ?? {
      id: senderId,
      fullName: 'Tài khoản không còn tồn tại',
      username: 'tai-khoan-da-xoa',
    },
    isOwn: senderId === currentUserId,
    createdAt: message.createdAt.toISOString(),
  }
}

const parseCursor = (rawCursor: unknown): MessageCursor | undefined => {
  if (rawCursor === undefined || rawCursor === '') return undefined
  if (typeof rawCursor !== 'string' || rawCursor.length > 512) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Cursor tin nhắn không hợp lệ.', {
      cursor: 'Cursor tin nhắn không hợp lệ.',
    })
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) throw new Error()
    const candidate = decoded as Record<string, unknown>
    if (typeof candidate.createdAt !== 'string' || typeof candidate.id !== 'string') throw new Error()
    const createdAt = new Date(candidate.createdAt)
    if (Number.isNaN(createdAt.getTime()) || !isValidObjectId(candidate.id)) throw new Error()
    return { createdAt, id: candidate.id }
  } catch {
    throw new AppError(422, 'VALIDATION_ERROR', 'Cursor tin nhắn không hợp lệ.', {
      cursor: 'Cursor tin nhắn không hợp lệ.',
    })
  }
}

const createCursor = (message: PersistedMessage): string => Buffer.from(JSON.stringify({
  createdAt: message.createdAt?.toISOString(),
  id: String(message._id),
})).toString('base64url')

const parseAnchor = (rawAnchor: unknown): string | undefined => {
  if (rawAnchor === undefined || rawAnchor === '') return undefined
  if (typeof rawAnchor !== 'string' || !isValidObjectId(rawAnchor)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Mốc tin nhắn không hợp lệ.', {
      anchor: 'Mốc tin nhắn không hợp lệ.',
    })
  }
  return rawAnchor
}

const toMessageItem = (
  rawMessage: unknown,
  usersById: ReadonlyMap<string, ChatUserSummary>,
): DirectChatMessageItem => {
  const message = rawMessage as PersistedMessage
  const senderId = String(message.senderId)
  const sender = usersById.get(senderId) ?? {
    id: senderId,
    fullName: 'Tài khoản không còn tồn tại',
    username: 'tai-khoan-da-xoa',
  }
  if (!message.createdAt) {
    throw new AppError(500, 'CHAT_MESSAGE_DATA_INVALID', 'Không thể đọc dữ liệu tin nhắn.')
  }
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    clientMessageId: message.clientMessageId,
    content: message.content,
    sender,
    createdAt: message.createdAt.toISOString(),
  }
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000

export const createDirectConversationsService = (repository: DirectConversationsRepositoryContract) => {
  const requireConversation = async (conversationId: string, userId: string): Promise<PersistedFriendship> => {
    requireConversationId(conversationId)
    const conversation = await repository.findAcceptedConversationById(conversationId, userId)
    if (!conversation) {
      throw new AppError(404, 'DIRECT_CONVERSATION_NOT_FOUND', 'Không tìm thấy cuộc trò chuyện.')
    }
    return conversation as PersistedFriendship
  }

  const mapMessages = async (rawMessages: unknown[]): Promise<DirectChatMessageItem[]> => {
    const senderIds = [...new Set(rawMessages.map((item) => String((item as PersistedMessage).senderId)))]
    const users = await repository.findUsersByIds(senderIds)
    const usersById = new Map(users.map((user) => {
      const summary = toUserSummary(user)
      return [summary.id, summary] as const
    }))
    return rawMessages.map((message) => toMessageItem(message, usersById))
  }

  return {
    async getConversations(userId: string): Promise<DirectConversationSummary[]> {
      const friendships = await repository.findAcceptedConversationsForUser(userId)
      const participantIds = friendships.map((item) => otherUserId(item as PersistedFriendship, userId))
      const conversationIds = friendships.map((item) => String((item as PersistedFriendship)._id))
      const [users, latestMessagesRaw] = await Promise.all([
        repository.findActiveUsersByIds(participantIds),
        repository.findLatestMessagesByConversationIds(conversationIds),
      ])
      const latestMessages = latestMessagesRaw as PersistedMessage[]
      const senderIds = [...new Set(latestMessages.map((message) => String(message.senderId)))]
      const senders = await repository.findUsersByIds(senderIds)
      const usersById = new Map(users.map((user) => {
        const summary = toUserSummary(user)
        return [summary.id, summary] as const
      }))
      const sendersById = new Map(senders.map((user) => {
        const summary = toUserSummary(user)
        return [summary.id, summary] as const
      }))
      const latestMessageByConversationId = new Map(latestMessages.map((message) => [
        String(message.conversationId),
        toLastMessageSummary(message, sendersById.get(String(message.senderId)), userId),
      ] as const))
      const rawUsersById = new Map(users.map((user) => [String((user as PersistedUser)._id), user] as const))
      return friendships.flatMap((item) => {
        const friendship = item as PersistedFriendship
        const participant = usersById.get(otherUserId(friendship, userId))
        const rawParticipant = participant ? rawUsersById.get(participant.id) : undefined
        return participant && rawParticipant
          ? [toConversationSummary(
            friendship,
            participant,
            rawParticipant,
            latestMessageByConversationId.get(String(friendship._id)),
          )]
          : []
      })
    },

    async getConversation(userId: string, conversationId: string): Promise<DirectConversationSummary> {
      const friendship = await requireConversation(conversationId, userId)
      const participant = await repository.findActiveUserById(otherUserId(friendship, userId))
      if (!participant) {
        throw new AppError(404, 'DIRECT_CONVERSATION_NOT_FOUND', 'Không tìm thấy cuộc trò chuyện.')
      }
      return toConversationSummary(friendship, toUserSummary(participant), participant)
    },

    async assertParticipant(userId: string, conversationId: string): Promise<void> {
      await requireConversation(conversationId, userId)
    },

    async getMessages(
      userId: string,
      conversationId: string,
      rawCursor: unknown,
      rawAnchor?: unknown,
    ): Promise<DirectChatMessagePage> {
      await requireConversation(conversationId, userId)
      const cursor = parseCursor(rawCursor)
      const anchorId = parseAnchor(rawAnchor)
      if (cursor && anchorId) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Chỉ được dùng một mốc phân trang tin nhắn.')
      }
      let anchor: MessageCursor | undefined
      if (anchorId) {
        const rawMessage = await repository.findMessageById(conversationId, anchorId)
        const message = rawMessage as PersistedMessage | null
        if (!message?.createdAt) {
          throw new AppError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Không tìm thấy tin nhắn.')
        }
        anchor = { createdAt: message.createdAt, id: String(message._id) }
      }
      const rawMessages = await repository.findMessages(conversationId, {
        ...(cursor ? { cursor } : {}),
        ...(anchor ? { anchor } : {}),
        limit: CHAT_MESSAGE_PAGE_SIZE + 1,
      })
      const hasMore = rawMessages.length > CHAT_MESSAGE_PAGE_SIZE
      const page = rawMessages.slice(0, CHAT_MESSAGE_PAGE_SIZE) as PersistedMessage[]
      const nextCursor = hasMore && page.length > 0 ? createCursor(page[page.length - 1]!) : null
      return { messages: await mapMessages([...page].reverse()), nextCursor }
    },

    async createMessage(
      userId: string,
      conversationId: string,
      rawInput: unknown,
    ): Promise<{ message: DirectChatMessageItem; created: boolean }> {
      const input: CreateChatMessageInput = validateCreateChatMessage(rawInput)
      await requireConversation(conversationId, userId)
      const sender = await repository.findActiveUserById(userId)
      if (!sender) {
        throw new AppError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'Tài khoản không thể sử dụng chức năng này.')
      }

      let rawMessage: unknown
      let created = true
      try {
        rawMessage = await repository.createMessage({
          conversationId,
          senderId: userId,
          clientMessageId: input.clientMessageId,
          content: input.content,
        })
        await repository.touchConversation(conversationId, new Date())
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error
        rawMessage = await repository.findByClientMessageId(conversationId, userId, input.clientMessageId)
        if (!rawMessage) throw error
        created = false
      }

      const senderSummary = toUserSummary(sender)
      return {
        message: toMessageItem(rawMessage, new Map([[senderSummary.id, senderSummary]])),
        created,
      }
    },
  }
}

export const directConversationsService = createDirectConversationsService(directConversationsRepository)
