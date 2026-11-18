import { Router } from 'express'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  acceptFriendRequest,
  blockUser,
  declineFriendRequest,
  getBlockedUsers,
  getChannels,
  getFriendRequests,
  getFriends,
  searchFriendUsers,
  sendFriendRequest,
  unblockUser,
} from '@/modules/chat/controllers/chat.controller.js'
import {
  createChatGroup,
  createChatGroupInviteLink,
  getChatGroup,
  getChatGroups,
  joinChatGroupByInvite,
  previewChatGroupInvite,
} from '@/modules/chat/controllers/chat-groups.controller.js'

export const chatRouter = Router()

chatRouter.use(authenticate)
chatRouter.get('/groups', getChatGroups)
chatRouter.post('/groups', requireCsrf, createChatGroup)
chatRouter.get('/groups/:groupId', getChatGroup)
chatRouter.post('/groups/:groupId/invite-link', requireCsrf, createChatGroupInviteLink)
chatRouter.get('/group-invites/:token', previewChatGroupInvite)
chatRouter.post('/group-invites/:token/join', requireCsrf, joinChatGroupByInvite)
chatRouter.get('/channels', getChannels)
chatRouter.get('/friends', getFriends)
chatRouter.get('/friends/search', searchFriendUsers)
chatRouter.get('/friend-requests', getFriendRequests)
chatRouter.post('/friend-requests', requireCsrf, sendFriendRequest)
chatRouter.post('/friend-requests/:requestId/accept', requireCsrf, acceptFriendRequest)
chatRouter.post('/friend-requests/:requestId/decline', requireCsrf, declineFriendRequest)
chatRouter.get('/blocked-users', getBlockedUsers)
chatRouter.post('/blocked-users', requireCsrf, blockUser)
chatRouter.delete('/blocked-users/:userId', requireCsrf, unblockUser)

