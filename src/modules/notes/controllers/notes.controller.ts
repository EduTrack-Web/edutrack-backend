import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '../../../shared/middleware/authenticate.js'
import { noteImageService } from '../services/note-image.service.js'
import { notesService } from '../services/notes.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const noteIdFrom = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

export const getNotes: RequestHandler = async (_request, response) => {
  const notes = await notesService.getUserNotes(userIdFrom(response.locals))
  response.json({ success: true, data: { notes } })
}

export const createNote: RequestHandler = async (_request, response) => {
  const note = await notesService.createNote(userIdFrom(response.locals))
  response.status(201).json({ success: true, data: { note }, message: 'Đã tạo ghi chú.' })
}

export const getNote: RequestHandler = async (request, response) => {
  const note = await notesService.getNote(userIdFrom(response.locals), noteIdFrom(request.params.noteId))
  response.json({ success: true, data: { note } })
}

export const updateNote: RequestHandler = async (request, response) => {
  const note = await notesService.updateNote(userIdFrom(response.locals), noteIdFrom(request.params.noteId), request.body)
  response.json({ success: true, data: { note }, message: 'Đã lưu ghi chú.' })
}

export const uploadImage: RequestHandler = async (request, response) => {
  const image = await noteImageService.upload(request.file, userIdFrom(response.locals))
  response.status(201).json({ success: true, data: { image }, message: 'Đã tải ảnh lên.' })
}

