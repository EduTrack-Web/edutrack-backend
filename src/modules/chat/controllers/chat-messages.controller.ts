import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import {
  CHAT_SOCKET_SERVER_KEY,
  publishChatMessage,
  type ChatSocketServer,
} from '@/modules/chat/realtime/chat.realtime.js'
import { chatMessagesService } from '@/modules/chat/services/chat-messages.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const pathValue = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

export const getChatGroupMessages: RequestHandler = async (request, response) => {
  const page = await chatMessagesService.getMessages(
    userIdFrom(response.locals),
    pathValue(request.params.groupId),
    request.query.cursor,
    request.query.anchor,
  )
  response.json({ success: true, data: page })
}

export const createChatGroupMessage: RequestHandler = async (request, response) => {
  const result = await chatMessagesService.createMessage(
    userIdFrom(response.locals),
    pathValue(request.params.groupId),
    request.body,
  )
  if (result.created) {
    const io = response.app.get(CHAT_SOCKET_SERVER_KEY) as ChatSocketServer | undefined
    if (io) publishChatMessage(io, result.message)
  }
  response.status(result.created ? 201 : 200).json({
    success: true,
    data: { message: result.message },
    message: result.created ? 'Đã gửi tin nhắn.' : 'Tin nhắn đã được ghi nhận trước đó.',
  })
}
