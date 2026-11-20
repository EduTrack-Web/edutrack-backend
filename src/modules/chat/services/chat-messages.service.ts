import { Buffer } from 'node:buffer'

import { isValidObjectId } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/modules/chat/config/chat.config.js'
import { chatMessagesRepository } from '@/modules/chat/repositories/chat-messages.repository.js'
import type {
  ChatMessageItem,
  ChatMessagePage,
  ChatUserSummary,
} from '@/modules/chat/types/chat.types.js'
import {
  validateCreateChatMessage,
  type CreateChatMessageInput,
} from '@/modules/chat/validations/chat-messages.validation.js'

interface PersistedGroup {
  _id: unknown
  historyVisibility: 'from_join' | 'all'
}

interface PersistedMembership {
  joinedAt: Date
}

interface PersistedMessage {
  _id: unknown
  groupId: unknown
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
}

interface MessageCursor {
  createdAt: Date
  id: string
}

export interface ChatMessagesRepositoryContract {
  findActiveGroupById: (groupId: string) => PromiseLike<unknown | null>
  findMembership: (groupId: string, userId: string) => PromiseLike<unknown | null>
  findActiveUserById: (userId: string) => PromiseLike<unknown | null>
  findUsersByIds: (userIds: readonly string[]) => PromiseLike<unknown[]>
  findMessages: (
    groupId: string,
    options: { visibleAfter?: Date; cursor?: MessageCursor; anchor?: MessageCursor; limit: number },
  ) => PromiseLike<unknown[]>
  findMessageById: (groupId: string, messageId: string, visibleAfter?: Date) => PromiseLike<unknown | null>
  createMessage: (input: {
    groupId: string
    senderId: string
    clientMessageId: string
    content: string
  }) => PromiseLike<unknown>
  findByClientMessageId: (
    groupId: string,
    senderId: string,
    clientMessageId: string,
  ) => PromiseLike<unknown | null>
  touchGroup: (groupId: string, activityAt: Date) => PromiseLike<unknown>
}

const requireGroupId = (groupId: string): void => {
  if (!isValidObjectId(groupId)) {
    throw new AppError(404, 'CHAT_GROUP_NOT_FOUND', 'Không tìm thấy nhóm trò chuyện.')
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

const toUserSummary = (rawUser: unknown): ChatUserSummary => {
  const user = rawUser as PersistedUser
  return {
    id: String(user._id),
    fullName: user.fullName,
    username: user.username,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
  }
}

const toMessageItem = (
  rawMessage: unknown,
  usersById: ReadonlyMap<string, ChatUserSummary>,
): ChatMessageItem => {
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
    groupId: String(message.groupId),
    clientMessageId: message.clientMessageId,
    content: message.content,
    sender,
    createdAt: message.createdAt.toISOString(),
  }
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000

export const createChatMessagesService = (repository: ChatMessagesRepositoryContract) => {
  const requireMembership = async (groupId: string, userId: string) => {
    requireGroupId(groupId)
    const [group, membership] = await Promise.all([
      repository.findActiveGroupById(groupId),
      repository.findMembership(groupId, userId),
    ])
    if (!group) throw new AppError(404, 'CHAT_GROUP_NOT_FOUND', 'Không tìm thấy nhóm trò chuyện.')
    if (!membership) {
      throw new AppError(403, 'CHAT_GROUP_MEMBERSHIP_REQUIRED', 'Chỉ thành viên mới có thể truy cập nội dung nhóm.')
    }
    return { group: group as PersistedGroup, membership: membership as PersistedMembership }
  }

  const mapMessages = async (rawMessages: unknown[]): Promise<ChatMessageItem[]> => {
    const senderIds = [...new Set(rawMessages.map((rawMessage) => String((rawMessage as PersistedMessage).senderId)))]
    const users = await repository.findUsersByIds(senderIds)
    const usersById = new Map(users.map((user) => {
      const summary = toUserSummary(user)
      return [summary.id, summary] as const
    }))
    return rawMessages.map((message) => toMessageItem(message, usersById))
  }

  return {
    async assertMembership(userId: string, groupId: string): Promise<void> {
      await requireMembership(groupId, userId)
    },

    async getMessages(
      userId: string,
      groupId: string,
      rawCursor: unknown,
      rawAnchor?: unknown,
    ): Promise<ChatMessagePage> {
      const { group, membership } = await requireMembership(groupId, userId)
      const cursor = parseCursor(rawCursor)
      const anchorId = parseAnchor(rawAnchor)
      if (cursor && anchorId) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Chỉ được dùng một mốc phân trang tin nhắn.')
      }
      const visibleAfter = group.historyVisibility === 'from_join' ? membership.joinedAt : undefined
      let anchor: MessageCursor | undefined
      if (anchorId) {
        const rawMessage = await repository.findMessageById(groupId, anchorId, visibleAfter)
        const message = rawMessage as PersistedMessage | null
        if (!message?.createdAt) {
          throw new AppError(404, 'CHAT_MESSAGE_NOT_FOUND', 'Không tìm thấy tin nhắn.')
        }
        anchor = { createdAt: message.createdAt, id: String(message._id) }
      }
      const rawMessages = await repository.findMessages(groupId, {
        ...(visibleAfter ? { visibleAfter } : {}),
        ...(cursor ? { cursor } : {}),
        ...(anchor ? { anchor } : {}),
        limit: CHAT_MESSAGE_PAGE_SIZE + 1,
      })
      const hasMore = rawMessages.length > CHAT_MESSAGE_PAGE_SIZE
      const page = rawMessages.slice(0, CHAT_MESSAGE_PAGE_SIZE) as PersistedMessage[]
      const nextCursor = hasMore && page.length > 0 ? createCursor(page[page.length - 1]!) : null
      const messages = await mapMessages([...page].reverse())
      return { messages, nextCursor }
    },

    async createMessage(
      userId: string,
      groupId: string,
      rawInput: unknown,
    ): Promise<{ message: ChatMessageItem; created: boolean }> {
      const input: CreateChatMessageInput = validateCreateChatMessage(rawInput)
      await requireMembership(groupId, userId)
      const sender = await repository.findActiveUserById(userId)
      if (!sender) {
        throw new AppError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'Tài khoản không thể sử dụng chức năng này.')
      }

      let rawMessage: unknown
      let created = true
      try {
        rawMessage = await repository.createMessage({
          groupId,
          senderId: userId,
          clientMessageId: input.clientMessageId,
          content: input.content,
        })
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error
        rawMessage = await repository.findByClientMessageId(groupId, userId, input.clientMessageId)
        if (!rawMessage) throw error
        created = false
      }

      const persistedMessage = rawMessage as PersistedMessage
      await repository.touchGroup(groupId, persistedMessage.createdAt ?? new Date())

      const senderSummary = toUserSummary(sender)
      return {
        message: toMessageItem(rawMessage, new Map([[senderSummary.id, senderSummary]])),
        created,
      }
    },
  }
}

export const chatMessagesService = createChatMessagesService(chatMessagesRepository)
