import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '../../../shared/middleware/authenticate.js'
import { chatGroupsService } from '../services/chat-groups.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const pathValue = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

export const createChatGroup: RequestHandler = async (request, response) => {
  const result = await chatGroupsService.createGroup(userIdFrom(response.locals), request.body)
  response.status(201).json({
    success: true,
    data: result,
    message: 'Tạo nhóm trò chuyện thành công.',
  })
}

export const getChatGroups: RequestHandler = async (_request, response) => {
  const groups = await chatGroupsService.getGroups(userIdFrom(response.locals))
  response.json({ success: true, data: { groups } })
}

export const getChatGroup: RequestHandler = async (request, response) => {
  const group = await chatGroupsService.getGroup(
    userIdFrom(response.locals),
    pathValue(request.params.groupId),
  )
  response.json({ success: true, data: { group } })
}

export const createChatGroupInviteLink: RequestHandler = async (request, response) => {
  const invite = await chatGroupsService.createInviteLink(
    userIdFrom(response.locals),
    pathValue(request.params.groupId),
  )
  response.status(201).json({
    success: true,
    data: { invite },
    message: 'Đã tạo liên kết tham gia nhóm mới.',
  })
}

export const previewChatGroupInvite: RequestHandler = async (request, response) => {
  const invite = await chatGroupsService.previewInvite(
    userIdFrom(response.locals),
    pathValue(request.params.token),
  )
  response.json({ success: true, data: { invite } })
}

export const joinChatGroupByInvite: RequestHandler = async (request, response) => {
  const group = await chatGroupsService.joinByInvite(
    userIdFrom(response.locals),
    pathValue(request.params.token),
  )
  response.status(201).json({
    success: true,
    data: { group },
    message: 'Tham gia nhóm thành công.',
  })
}
