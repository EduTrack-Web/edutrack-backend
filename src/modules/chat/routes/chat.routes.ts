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
chatRouter.post('/groups/:groupId/invite-links', requireCsrf, createChatGroupInviteLink)
chatRouter.get('/group-invitations/:token', previewChatGroupInvite)
chatRouter.post('/group-invitations/:token/membership', requireCsrf, joinChatGroupByInvite)
chatRouter.get('/direct-conversations', getDirectConversations)
chatRouter.get('/direct-conversations/:conversationId', getDirectConversation)
chatRouter.get('/direct-conversations/:conversationId/messages', getDirectConversationMessages)
chatRouter.post('/direct-conversations/:conversationId/messages', requireCsrf, createDirectConversationMessage)
chatRouter.get('/channels', getChannels)
chatRouter.get('/friendships', getFriends)
chatRouter.get('/friend-candidates', searchFriendUsers)
chatRouter.get('/friend-requests', getFriendRequests)
chatRouter.post('/friend-requests', requireCsrf, sendFriendRequest)
chatRouter.post('/friend-requests/:requestId/acceptance', requireCsrf, acceptFriendRequest)
chatRouter.delete('/received-friend-requests/:requestId', requireCsrf, declineFriendRequest)
chatRouter.delete('/sent-friend-requests/:requestId', requireCsrf, revokeFriendRequest)
chatRouter.get('/blocked-users', getBlockedUsers)
chatRouter.post('/blocked-users', requireCsrf, blockUser)
chatRouter.delete('/blocked-users/:userId', requireCsrf, unblockUser)

