import type { Server as HttpServer } from 'node:http'

import { Server } from 'socket.io'

import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'
import { UserModel } from '@/modules/auth/models/user.model.js'
import { verifyAccessToken } from '@/modules/auth/services/token.service.js'
import { chatMessagesService } from '@/modules/chat/services/chat-messages.service.js'
import { directConversationsService } from '@/modules/chat/services/direct-conversations.service.js'
import type { ChatMessageItem, ChatPresenceItem, DirectChatMessageItem } from '@/modules/chat/types/chat.types.js'

export const CHAT_SOCKET_SERVER_KEY = 'chatSocketServer'
export const CHAT_SOCKET_PATH = '/v1/api/socket.io'

interface JoinGroupPayload {
  groupId: string
}

interface JoinDirectConversationPayload {
  conversationId: string
}

interface SocketAcknowledgement {
  success: boolean
  code?: string
  message?: string
}

interface ClientToServerEvents {
  'chat:join-group': (
    payload: unknown,
    acknowledge?: (result: SocketAcknowledgement) => void,
  ) => void
  'chat:leave-group': (payload: unknown) => void
  'chat:join-direct-conversation': (
    payload: unknown,
    acknowledge?: (result: SocketAcknowledgement) => void,
  ) => void
  'chat:leave-direct-conversation': (payload: unknown) => void
}

interface ServerToClientEvents {
  'chat:message-created': (message: ChatMessageItem) => void
  'chat:direct-message-created': (message: DirectChatMessageItem) => void
  'chat:presence-changed': (presence: ChatPresenceItem) => void
}

interface SocketData {
  userId: string
}

export type ChatSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

const groupRoom = (groupId: string): string => `chat:group:${groupId}`
const directConversationRoom = (conversationId: string): string => `chat:direct:${conversationId}`
const socketIdsByUserId = new Map<string, Set<string>>()

export const isChatUserOnline = (userId: string): boolean =>
  (socketIdsByUserId.get(userId)?.size ?? 0) > 0

const registerOnlineSocket = (userId: string, socketId: string): boolean => {
  const socketIds = socketIdsByUserId.get(userId) ?? new Set<string>()
  const wasOffline = socketIds.size === 0
  socketIds.add(socketId)
  socketIdsByUserId.set(userId, socketIds)
  return wasOffline
}

const unregisterOnlineSocket = (userId: string, socketId: string): boolean => {
  const socketIds = socketIdsByUserId.get(userId)
  if (!socketIds) return false
  socketIds.delete(socketId)
  if (socketIds.size > 0) return false
  socketIdsByUserId.delete(userId)
  return true
}

const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex < 0) continue
    const key = pair.slice(0, separatorIndex).trim()
    if (key !== name) continue
    const value = pair.slice(separatorIndex + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return undefined
    }
  }
  return undefined
}

const parseJoinPayload = (value: unknown): JoinGroupPayload | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const groupId = (value as Record<string, unknown>).groupId
  return typeof groupId === 'string' ? { groupId } : null
}

const parseDirectConversationPayload = (value: unknown): JoinDirectConversationPayload | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const conversationId = (value as Record<string, unknown>).conversationId
  return typeof conversationId === 'string' ? { conversationId } : null
}

export const createChatSocketServer = (httpServer: HttpServer): ChatSocketServer => {
  const io: ChatSocketServer = new Server(httpServer, {
    path: CHAT_SOCKET_PATH,
    cors: { origin: env.clientOrigins, credentials: true },
  })

  io.use((socket, next) => {
    const token = readCookie(socket.handshake.headers.cookie, 'edutrack_access')
    if (!token) {
      next(new Error('AUTHENTICATION_REQUIRED'))
      return
    }
    try {
      const payload = verifyAccessToken(token)
      socket.data.userId = payload.userId
      next()
    } catch {
      next(new Error('INVALID_ACCESS_TOKEN'))
    }
  })

  io.on('connection', (socket) => {
    if (registerOnlineSocket(socket.data.userId, socket.id)) {
      io.emit('chat:presence-changed', { userId: socket.data.userId, isOnline: true })
    }

    socket.on('disconnect', () => {
      if (!unregisterOnlineSocket(socket.data.userId, socket.id)) return
      const lastActiveAt = new Date()
      io.emit('chat:presence-changed', {
        userId: socket.data.userId,
        isOnline: false,
        lastActiveAt: lastActiveAt.toISOString(),
      })
      void UserModel.updateOne(
        { _id: socket.data.userId },
        { $set: { lastActiveAt } },
      ).catch(() => undefined)
    })

    socket.on('chat:join-group', async (rawPayload, acknowledge) => {
      const payload = parseJoinPayload(rawPayload)
      if (!payload) {
        acknowledge?.({ success: false, code: 'VALIDATION_ERROR', message: 'Nhóm trò chuyện không hợp lệ.' })
        return
      }
      try {
        await chatMessagesService.assertMembership(socket.data.userId, payload.groupId)
        await socket.join(groupRoom(payload.groupId))
        acknowledge?.({ success: true })
      } catch (error) {
        const appError = error instanceof AppError ? error : null
        acknowledge?.({
          success: false,
          code: appError?.code ?? 'CHAT_SOCKET_ERROR',
          message: appError?.message ?? 'Không thể kết nối cuộc trò chuyện.',
        })
      }
    })

    socket.on('chat:leave-group', (rawPayload) => {
      const payload = parseJoinPayload(rawPayload)
      if (payload) void socket.leave(groupRoom(payload.groupId))
    })

    socket.on('chat:join-direct-conversation', async (rawPayload, acknowledge) => {
      const payload = parseDirectConversationPayload(rawPayload)
      if (!payload) {
        acknowledge?.({ success: false, code: 'VALIDATION_ERROR', message: 'Cuộc trò chuyện không hợp lệ.' })
        return
      }
      try {
        await directConversationsService.assertParticipant(socket.data.userId, payload.conversationId)
        await socket.join(directConversationRoom(payload.conversationId))
        acknowledge?.({ success: true })
      } catch (error) {
        const appError = error instanceof AppError ? error : null
        acknowledge?.({
          success: false,
          code: appError?.code ?? 'CHAT_SOCKET_ERROR',
          message: appError?.message ?? 'Không thể kết nối cuộc trò chuyện.',
        })
      }
    })

    socket.on('chat:leave-direct-conversation', (rawPayload) => {
      const payload = parseDirectConversationPayload(rawPayload)
      if (payload) void socket.leave(directConversationRoom(payload.conversationId))
    })
  })

  return io
}

export const publishChatMessage = (io: ChatSocketServer, message: ChatMessageItem): void => {
  io.to(groupRoom(message.groupId)).emit('chat:message-created', message)
}

export const publishDirectChatMessage = (
  io: ChatSocketServer,
  message: DirectChatMessageItem,
): void => {
  io.to(directConversationRoom(message.conversationId)).emit('chat:direct-message-created', message)
}
