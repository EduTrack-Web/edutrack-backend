import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '@/shared/middleware/authenticate.js'
import { chatService } from '@/modules/chat/services/chat.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const pathValue = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

export const getChannels: RequestHandler = async (_request, response) => {
  const channels = await chatService.getUserChannels(userIdFrom(response.locals))
  response.json({ success: true, data: { channels } })
}

export const getFriends: RequestHandler = async (request, response) => {
  const friends = await chatService.getFriends(userIdFrom(response.locals), request.query.q)
  response.json({ success: true, data: { friends } })
}

export const searchFriendUsers: RequestHandler = async (request, response) => {
  const users = await chatService.searchUsers(userIdFrom(response.locals), request.query.q)
  response.json({ success: true, data: { users } })
}

export const getFriendRequests: RequestHandler = async (_request, response) => {
  const requests = await chatService.getFriendRequests(userIdFrom(response.locals))
  response.json({ success: true, data: { requests } })
}

export const sendFriendRequest: RequestHandler = async (request, response) => {
  const friendRequest = await chatService.sendFriendRequest(userIdFrom(response.locals), request.body)
  response.status(201).json({
    success: true,
    data: { request: friendRequest },
    message: 'Đã gửi lời mời kết bạn.',
  })
}

export const acceptFriendRequest: RequestHandler = async (request, response) => {
  const friend = await chatService.acceptFriendRequest(
    userIdFrom(response.locals),
    pathValue(request.params.requestId),
  )
  response.json({ success: true, data: { friend }, message: 'Đã chấp nhận lời mời kết bạn.' })
}

export const declineFriendRequest: RequestHandler = async (request, response) => {
  await chatService.declineFriendRequest(
    userIdFrom(response.locals),
    pathValue(request.params.requestId),
  )
  response.json({ success: true, data: {}, message: 'Đã từ chối lời mời kết bạn.' })
}

export const getBlockedUsers: RequestHandler = async (_request, response) => {
  const users = await chatService.getBlockedUsers(userIdFrom(response.locals))
  response.json({ success: true, data: { users } })
}

export const blockUser: RequestHandler = async (request, response) => {
  const user = await chatService.blockUser(userIdFrom(response.locals), request.body)
  response.status(201).json({
    success: true,
    data: { user },
    message: 'Đã chặn người dùng và hủy quan hệ bạn bè hiện có.',
  })
}

export const unblockUser: RequestHandler = async (request, response) => {
  await chatService.unblockUser(
    userIdFrom(response.locals),
    pathValue(request.params.userId),
  )
  response.json({ success: true, data: {}, message: 'Đã bỏ chặn người dùng.' })
}
