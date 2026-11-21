import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
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
  revokeFriendRequest,
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
import {
  createChatGroupMessage,
  getChatGroupMessages,
} from '@/modules/chat/controllers/chat-messages.controller.js'
import {
  createDirectConversationMessage,
  getDirectConversation,
  getDirectConversationMessages,
  getDirectConversations,
} from '@/modules/chat/controllers/direct-conversations.controller.js'
import { searchChatMessages } from '@/modules/chat/controllers/chat-search.controller.js'

export const chatRouter = Router()
export const chatRestRouter = Router()
const chatSearchLimiter = rateLimit({
  windowMs: 60 * 1_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      success: false,
      code: 'CHAT_SEARCH_RATE_LIMITED',
      message: 'Bạn tìm kiếm quá nhanh. Vui lòng thử lại sau.',
    })
  },
})

chatRouter.use(authenticate)
chatRouter.get('/messages', chatSearchLimiter, searchChatMessages)
chatRouter.get('/groups', getChatGroups)
chatRouter.post('/groups', requireCsrf, createChatGroup)
chatRouter.get('/groups/:groupId', getChatGroup)
chatRouter.get('/groups/:groupId/messages', getChatGroupMessages)
chatRouter.post('/groups/:groupId/messages', requireCsrf, createChatGroupMessage)
chatRouter.post('/groups/:groupId/invite-link', requireCsrf, createChatGroupInviteLink)
chatRouter.get('/group-invites/:token', previewChatGroupInvite)
chatRouter.post('/group-invites/:token/join', requireCsrf, joinChatGroupByInvite)
chatRouter.get('/direct-conversations', getDirectConversations)
chatRouter.get('/direct-conversations/:conversationId', getDirectConversation)
chatRouter.get('/direct-conversations/:conversationId/messages', getDirectConversationMessages)
chatRouter.post('/direct-conversations/:conversationId/messages', requireCsrf, createDirectConversationMessage)
chatRouter.get('/channels', getChannels)
chatRouter.get('/friends', getFriends)
chatRouter.get('/friends/search', searchFriendUsers)
chatRouter.get('/friend-requests', getFriendRequests)
chatRouter.post('/friend-requests', requireCsrf, sendFriendRequest)
chatRouter.post('/friend-requests/:requestId/accept', requireCsrf, acceptFriendRequest)
chatRouter.post('/friend-requests/:requestId/decline', requireCsrf, declineFriendRequest)
chatRouter.delete('/friend-requests/:requestId', requireCsrf, revokeFriendRequest)
chatRouter.get('/blocked-users', getBlockedUsers)
chatRouter.post('/blocked-users', requireCsrf, blockUser)
chatRouter.delete('/blocked-users/:userId', requireCsrf, unblockUser)

chatRestRouter.use(authenticate)
chatRestRouter.get('/messages', chatSearchLimiter, searchChatMessages)
chatRestRouter.get('/groups', getChatGroups)
chatRestRouter.post('/groups', requireCsrf, createChatGroup)
chatRestRouter.get('/groups/:groupId', getChatGroup)
chatRestRouter.get('/groups/:groupId/messages', getChatGroupMessages)
chatRestRouter.post('/groups/:groupId/messages', requireCsrf, createChatGroupMessage)
chatRestRouter.post('/groups/:groupId/invite-links', requireCsrf, createChatGroupInviteLink)
chatRestRouter.get('/group-invitations/:token', previewChatGroupInvite)
chatRestRouter.post('/group-invitations/:token/membership', requireCsrf, joinChatGroupByInvite)
chatRestRouter.get('/direct-conversations', getDirectConversations)
chatRestRouter.get('/direct-conversations/:conversationId', getDirectConversation)
chatRestRouter.get('/direct-conversations/:conversationId/messages', getDirectConversationMessages)
chatRestRouter.post('/direct-conversations/:conversationId/messages', requireCsrf, createDirectConversationMessage)
chatRestRouter.get('/channels', getChannels)
chatRestRouter.get('/friendships', getFriends)
chatRestRouter.get('/friend-candidates', searchFriendUsers)
chatRestRouter.get('/friend-requests', getFriendRequests)
chatRestRouter.post('/friend-requests', requireCsrf, sendFriendRequest)
chatRestRouter.post('/friend-requests/:requestId/acceptance', requireCsrf, acceptFriendRequest)
chatRestRouter.delete('/received-friend-requests/:requestId', requireCsrf, declineFriendRequest)
chatRestRouter.delete('/sent-friend-requests/:requestId', requireCsrf, revokeFriendRequest)
chatRestRouter.get('/blocked-users', getBlockedUsers)
chatRestRouter.post('/blocked-users', requireCsrf, blockUser)
chatRestRouter.delete('/blocked-users/:userId', requireCsrf, unblockUser)

