import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '../../src/shared/errors/app-error.js'
import {
  createChatService,
  type ChatFriendsRepositoryContract,
} from '../../src/modules/chat/services/chat.service.js'

const currentUserId = '000000000000000000000001'
const friendUserId = '000000000000000000000002'
const strangerUserId = '000000000000000000000003'
const requestId = '000000000000000000000010'

const user = (id: string, username: string) => ({
  _id: id,
  fullName: `Người dùng ${username}`,
  username,
  email: `${username}@example.com`,
})

const friendship = (
  userAId: string,
  userBId: string,
  requestedById: string,
  status: 'pending' | 'accepted',
) => ({
  _id: requestId,
  userAId,
  userBId,
  requestedById,
  status,
  createdAt: new Date('2026-11-06T00:00:00.000Z'),
})

const createRepository = (
  overrides: Partial<ChatFriendsRepositoryContract> = {},
): ChatFriendsRepositoryContract => ({
  findChannelsByUserId: async () => [],
  findActiveUserById: async (userId) => user(userId, userId === currentUserId ? 'current' : 'target'),
  findActiveUserByExactIdentifier: async () => null,
  findActiveUsersByIds: async () => [],
  findUsersByIds: async () => [],
  findFriendshipByPair: async () => null,
  createFriendRequest: async (userAId, userBId, requestedById) =>
    friendship(userAId, userBId, requestedById, 'pending'),
  findPendingRequestsForUser: async () => [],
  findAcceptedFriendshipsForUser: async () => [],
  acceptFriendRequest: async () => null,
  declineFriendRequest: async () => null,
  deleteRelationshipBetween: async () => ({ deletedCount: 0 }),
  findBlocksForUser: async () => [],
  findBlocksByBlocker: async () => [],
  findBlockBetween: async () => null,
  upsertBlock: async (blockerId, blockedId) => ({
    blockerId,
    blockedId,
    createdAt: new Date('2026-11-06T00:00:00.000Z'),
  }),
  deleteBlock: async () => ({ deletedCount: 1 }),
  ...overrides,
})

test('returns fuzzy friend matches but only exact stranger matches', async () => {
  const friend = user(friendUserId, 'an-friend')
  const stranger = user(strangerUserId, 'an-stranger')
  const repository = createRepository({
    findAcceptedFriendshipsForUser: async () => [
      friendship(currentUserId, friendUserId, currentUserId, 'accepted'),
    ],
    findActiveUserByExactIdentifier: async (identifier) => identifier === 'an-stranger' ? stranger : null,
    findActiveUsersByIds: async (ids, query) =>
      ids.includes(friendUserId) && query === 'an' ? [friend] : [],
  })
  const service = createChatService(repository)

  const partialResults = await service.searchUsers(currentUserId, 'an')
  assert.deepEqual(partialResults.map((item) => item.username), ['an-friend'])
  assert.equal(partialResults[0]?.relation, 'friend')

  const exactResults = await service.searchUsers(currentUserId, 'an-stranger')
  assert.deepEqual(exactResults.map((item) => item.username), ['an-stranger'])
  assert.equal(exactResults[0]?.exactMatch, true)
  assert.equal('email' in (exactResults[0] ?? {}), false)
})

test('hides users when either side has blocked the other', async () => {
  const repository = createRepository({
    findActiveUserByExactIdentifier: async () => user(strangerUserId, 'blocked-user'),
    findBlocksForUser: async () => [{ blockerId: strangerUserId, blockedId: currentUserId }],
  })
  const service = createChatService(repository)

  assert.deepEqual(await service.searchUsers(currentUserId, 'blocked-user'), [])
})

test('does not return a blocked account from the accepted friends list', async () => {
  const repository = createRepository({
    findAcceptedFriendshipsForUser: async () => [
      friendship(currentUserId, friendUserId, currentUserId, 'accepted'),
    ],
    findBlocksForUser: async () => [{ blockerId: currentUserId, blockedId: friendUserId }],
    findActiveUsersByIds: async (userIds) => userIds.includes(friendUserId) ? [user(friendUserId, 'friend')] : [],
  })
  const service = createChatService(repository)

  assert.deepEqual(await service.getFriends(currentUserId), [])
})

test('creates an outgoing request with a canonical user pair', async () => {
  let capturedPair: string[] = []
  const repository = createRepository({
    findActiveUserByExactIdentifier: async () => user(strangerUserId, 'stranger'),
    createFriendRequest: async (userAId, userBId, requestedById) => {
      capturedPair = [userAId, userBId, requestedById]
      return friendship(userAId, userBId, requestedById, 'pending')
    },
  })
  const service = createChatService(repository)

  const result = await service.sendFriendRequest(currentUserId, { identifier: 'STRANGER' })

  assert.deepEqual(capturedPair, [currentUserId, strangerUserId, currentUserId])
  assert.equal(result.direction, 'outgoing')
  assert.equal(result.user.username, 'stranger')
})

test('does not create a request when an interaction is blocked', async () => {
  const repository = createRepository({
    findActiveUserByExactIdentifier: async () => user(strangerUserId, 'stranger'),
    findBlockBetween: async () => ({ blockerId: strangerUserId, blockedId: currentUserId }),
  })
  const service = createChatService(repository)

  await assert.rejects(
    service.sendFriendRequest(currentUserId, { identifier: 'stranger' }),
    (error: unknown) => error instanceof AppError && error.code === 'USER_INTERACTION_BLOCKED',
  )
})

test('maps incoming and outgoing requests without exposing email', async () => {
  const incoming = friendship(currentUserId, friendUserId, friendUserId, 'pending')
  const outgoing = {
    ...friendship(currentUserId, strangerUserId, currentUserId, 'pending'),
    _id: '000000000000000000000011',
  }
  const repository = createRepository({
    findPendingRequestsForUser: async () => [incoming, outgoing],
    findActiveUsersByIds: async () => [user(friendUserId, 'incoming'), user(strangerUserId, 'outgoing')],
  })
  const service = createChatService(repository)

  const result = await service.getFriendRequests(currentUserId)

  assert.deepEqual(result.map((item) => item.direction), ['incoming', 'outgoing'])
  assert.equal(result.some((item) => 'email' in item.user), false)
})

test('accepts only a request resolved by the repository for its recipient', async () => {
  const repository = createRepository({
    acceptFriendRequest: async () => friendship(currentUserId, friendUserId, friendUserId, 'accepted'),
    findActiveUserById: async (userId) => user(userId, userId === currentUserId ? 'current' : 'friend'),
  })
  const service = createChatService(repository)

  const result = await service.acceptFriendRequest(currentUserId, requestId)

  assert.equal(result.id, friendUserId)
})

test('blocking removes an accepted or pending relationship', async () => {
  let removedPair: string[] = []
  const repository = createRepository({
    findActiveUserById: async (userId) => user(userId, userId === currentUserId ? 'current' : 'target'),
    deleteRelationshipBetween: async (userAId, userBId) => {
      removedPair = [userAId, userBId]
      return { deletedCount: 1 }
    },
  })
  const service = createChatService(repository)

  const result = await service.blockUser(currentUserId, { userId: strangerUserId })

  assert.deepEqual(removedPair, [currentUserId, strangerUserId])
  assert.equal(result.id, strangerUserId)
})

test('rejects unblocking a relationship that does not exist', async () => {
  const repository = createRepository({ deleteBlock: async () => ({ deletedCount: 0 }) })
  const service = createChatService(repository)

  await assert.rejects(
    service.unblockUser(currentUserId, strangerUserId),
    (error: unknown) => error instanceof AppError && error.code === 'BLOCK_NOT_FOUND',
  )
})
