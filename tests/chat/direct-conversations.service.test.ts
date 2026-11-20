import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import {
  createDirectConversationsService,
  type DirectConversationsRepositoryContract,
} from '@/modules/chat/services/direct-conversations.service.js'

const currentUserId = new Types.ObjectId().toString()
const friendUserId = new Types.ObjectId().toString()
const conversationId = new Types.ObjectId().toString()
const createdAt = new Date('2026-11-18T01:00:00.000Z')

const conversation = () => ({
  _id: new Types.ObjectId(conversationId),
  userAId: new Types.ObjectId(currentUserId),
  userBId: new Types.ObjectId(friendUserId),
  status: 'accepted',
  createdAt,
  updatedAt: createdAt,
})

const user = (id = friendUserId) => ({
  _id: new Types.ObjectId(id),
  fullName: id === currentUserId ? 'Người dùng hiện tại' : 'Nguyễn Văn Bạn',
  username: id === currentUserId ? 'nguoi-dung-0001' : 'nguyen-van-ban-0002',
  lastActiveAt: createdAt,
})

const message = () => ({
  _id: new Types.ObjectId(),
  conversationId: new Types.ObjectId(conversationId),
  senderId: new Types.ObjectId(currentUserId),
  clientMessageId: 'direct_message_0001',
  content: 'Xin chào',
  createdAt,
})

const createRepository = (
  overrides: Partial<DirectConversationsRepositoryContract> = {},
): DirectConversationsRepositoryContract => ({
  findAcceptedConversationsForUser: async () => [conversation()],
  findAcceptedConversationById: async () => conversation(),
  findActiveUserById: async (userId) => user(userId),
  findActiveUsersByIds: async () => [user()],
  findUsersByIds: async () => [user(currentUserId)],
  findLatestMessagesByConversationIds: async () => [],
  touchConversation: async () => ({ modifiedCount: 1 }),
  findMessages: async () => [],
  findMessageById: async () => null,
  createMessage: async (input) => ({ ...message(), ...input }),
  findByClientMessageId: async () => null,
  ...overrides,
})

test('maps every accepted friendship to one direct conversation', async () => {
  const service = createDirectConversationsService(createRepository())

  const result = await service.getConversations(currentUserId)

  assert.equal(result.length, 1)
  assert.equal(result[0]?.id, conversationId)
  assert.equal(result[0]?.participant.id, friendUserId)
  assert.equal(result[0]?.participant.isOnline, false)
  assert.equal(result[0]?.participant.lastActiveAt, createdAt.toISOString())
})

test('includes the latest direct message in the conversation summary', async () => {
  const latestMessage = message()
  const service = createDirectConversationsService(createRepository({
    findLatestMessagesByConversationIds: async () => [latestMessage],
  }))

  const result = await service.getConversations(currentUserId)

  assert.equal(result[0]?.lastMessage?.content, latestMessage.content)
  assert.equal(result[0]?.lastMessage?.isOwn, true)
  assert.equal(result[0]?.lastMessage?.createdAt, createdAt.toISOString())
})

test('requires the current user to be an accepted participant', async () => {
  const service = createDirectConversationsService(createRepository({
    findAcceptedConversationById: async () => null,
  }))

  await assert.rejects(
    service.getMessages(currentUserId, conversationId, undefined),
    (error: unknown) => error instanceof AppError && error.code === 'DIRECT_CONVERSATION_NOT_FOUND',
  )
})

test('loads the page anchored at a selected direct message', async () => {
  const selectedMessage = message()
  let capturedAnchor: { createdAt: Date; id: string } | undefined
  const service = createDirectConversationsService(createRepository({
    findMessageById: async () => selectedMessage,
    findMessages: async (_conversationId, options) => {
      capturedAnchor = options.anchor
      return [selectedMessage]
    },
  }))

  const result = await service.getMessages(
    currentUserId,
    conversationId,
    undefined,
    String(selectedMessage._id),
  )

  assert.equal(capturedAnchor?.id, String(selectedMessage._id))
  assert.equal(result.messages[0]?.id, String(selectedMessage._id))
})

test('creates a direct message and moves the conversation to the latest position', async () => {
  let touchedConversationId = ''
  const service = createDirectConversationsService(createRepository({
    touchConversation: async (id) => {
      touchedConversationId = id
      return { modifiedCount: 1 }
    },
  }))

  const result = await service.createMessage(currentUserId, conversationId, {
    content: 'Xin chào',
    clientMessageId: 'direct_message_0001',
  })

  assert.equal(result.created, true)
  assert.equal(result.message.conversationId, conversationId)
  assert.equal(touchedConversationId, conversationId)
})

test('returns the existing direct message when a technical retry repeats its client id', async () => {
  const duplicateError = Object.assign(new Error('duplicate'), { code: 11000 })
  const storedMessage = message()
  const service = createDirectConversationsService(createRepository({
    createMessage: async () => { throw duplicateError },
    findByClientMessageId: async () => storedMessage,
  }))

  const result = await service.createMessage(currentUserId, conversationId, {
    content: storedMessage.content,
    clientMessageId: storedMessage.clientMessageId,
  })

  assert.equal(result.created, false)
  assert.equal(result.message.id, String(storedMessage._id))
})
