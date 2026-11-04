import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '../../../shared/middleware/authenticate.js'
import { noteSharesService } from '../services/note-shares.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const pathValue = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

export const searchShareUsers: RequestHandler = async (request, response) => {
  const users = await noteSharesService.searchUsers(
    userIdFrom(response.locals),
    pathValue(request.params.noteId),
    request.query.q,
  )
  response.json({ success: true, data: { users } })
}

export const getNoteCollaborators: RequestHandler = async (request, response) => {
  const result = await noteSharesService.getCollaborators(
    userIdFrom(response.locals),
    pathValue(request.params.noteId),
  )
  response.json({ success: true, data: result })
}

export const setNoteCollaborator: RequestHandler = async (request, response) => {
  const collaborator = await noteSharesService.setCollaborator(
    userIdFrom(response.locals),
    pathValue(request.params.noteId),
    request.body,
  )
  response.json({ success: true, data: { collaborator }, message: 'Đã cập nhật quyền truy cập ghi chú.' })
}

export const removeNoteCollaborator: RequestHandler = async (request, response) => {
  await noteSharesService.removeCollaborator(
    userIdFrom(response.locals),
    pathValue(request.params.noteId),
    pathValue(request.params.userId),
  )
  response.json({ success: true, data: {}, message: 'Đã thu hồi quyền truy cập ghi chú.' })
}
