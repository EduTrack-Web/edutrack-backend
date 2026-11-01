import type { RequestHandler } from 'express'
import { chatService } from './chat.service.js'

export const getChannels: RequestHandler = async (_request, response) => {
  const auth = response.locals.auth as { userId: string } | undefined
  const channels = await chatService.getUserChannels(auth?.userId ?? '')
  response.json({
    success: true,
    data: { channels },
    message: 'Danh sách kênh thảo luận học tập',
  })
}

