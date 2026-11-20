import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import {
  CHAT_SOCKET_SERVER_KEY,
  isChatUserOnline,
  publishDirectChatMessage,
  type ChatSocketServer,
} from '@/modules/chat/realtime/chat.realtime.js'
import { directConversationsService } from '@/modules/chat/services/direct-conversations.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const pathValue = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

const withCurrentPresence = <T extends { participant: { id: string; isOnline: boolean } }>(
  conversation: T,
): T => ({
  ...conversation,
  participant: {
    ...conversation.participant,
    isOnline: isChatUserOnline(conversation.participant.id),
  },
})

export const getDirectConversations: RequestHandler = async (_request, response) => {
  const conversations = await directConversationsService.getConversations(userIdFrom(response.locals))
  response.json({ success: true, data: { conversations: conversations.map(withCurrentPresence) } })
}

export const getDirectConversation: RequestHandler = async (request, response) => {
  const conversation = await directConversationsService.getConversation(
    userIdFrom(response.locals),
    pathValue(request.params.conversationId),
  )
  response.json({ success: true, data: { conversation: withCurrentPresence(conversation) } })
}

export const getDirectConversationMessages: RequestHandler = async (request, response) => {
  const page = await directConversationsService.getMessages(
    userIdFrom(response.locals),
    pathValue(request.params.conversationId),
    request.query.cursor,
    request.query.anchor,
  )
  response.json({ success: true, data: page })
}

export const createDirectConversationMessage: RequestHandler = async (request, response) => {
  const result = await directConversationsService.createMessage(
    userIdFrom(response.locals),
    pathValue(request.params.conversationId),
    request.body,
  )
  if (result.created) {
    const io = response.app.get(CHAT_SOCKET_SERVER_KEY) as ChatSocketServer | undefined
    if (io) publishDirectChatMessage(io, result.message)
  }
  response.status(result.created ? 201 : 200).json({
    success: true,
    data: { message: result.message },
    message: result.created ? 'Đã gửi tin nhắn.' : 'Tin nhắn đã được ghi nhận trước đó.',
  })
}
