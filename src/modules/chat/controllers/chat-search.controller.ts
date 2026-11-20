import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import { chatSearchService } from '@/modules/chat/services/chat-search.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

export const searchChatMessages: RequestHandler = async (request, response) => {
  const messages = await chatSearchService.searchMessages(
    userIdFrom(response.locals),
    request.query.q,
  )
  response.json({ success: true, data: { messages } })
}
