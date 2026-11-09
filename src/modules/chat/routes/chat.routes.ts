import { Router } from 'express'
import { authenticate } from '../../../shared/middleware/authenticate.js'
import { requireCsrf } from '../../../shared/middleware/csrf.js'
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
} from '../controllers/chat.controller.js'

export const chatRouter = Router()

chatRouter.use(authenticate)
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

