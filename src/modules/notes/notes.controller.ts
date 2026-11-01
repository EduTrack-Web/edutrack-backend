import type { RequestHandler } from 'express'
import { notesService } from './notes.service.js'

export const getNotes: RequestHandler = async (_request, response) => {
  const auth = response.locals.auth as { userId: string } | undefined
  const notes = await notesService.getUserNotes(auth?.userId ?? '')
  response.json({
    success: true,
    data: { notes },
    message: 'Danh sách ghi chú học tập',
  })
}

