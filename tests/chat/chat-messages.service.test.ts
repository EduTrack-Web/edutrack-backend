import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/modules/chat/config/chat.config.js'
import {
  createChatMessagesService,
  type ChatMessagesRepositoryContract,
} from '@/modules/chat/services/chat-messages.service.js'

const groupId = new Types.ObjectId().toString()
const userId = new Types.ObjectId().toString()
const joinedAt = new Date('2026-11-12T01:00:00.000Z')

const user = () => ({
  _id: new Types.ObjectId(userId),
  fullName: 'Nguyễn Văn A',
  username: 'nguyen-van-a-1234',
})

const message = (index = 0) => ({
  _id: new Types.ObjectId(),
  groupId: new Types.ObjectId(groupId),
  senderId: new Types.ObjectId(userId),
  clientMessageId: `message_${String(index).padStart(8, '0')}`,
  content: `Tin nhắn ${index}`,
  createdAt: new Date(joinedAt.getTime() + index * 1_000),
})

const createRepository = (
  overrides: Partial<ChatMessagesRepositoryContract> = {},
): ChatMessagesRepositoryContract => ({
  findActiveGroupById: async () => ({ _id: groupId, historyVisibility: 'from_join' }),
  findMembership: async () => ({ groupId, userId, joinedAt }),
  findActiveUserById: async () => user(),
  findUsersByIds: async () => [user()],
  findMessages: async () => [],
  findMessageById: async () => null,
  createMessage: async (input) => ({ ...message(), ...input }),
  findByClientMessageId: async () => null,
  touchGroup: async () => undefined,
  ...overrides,
})

test('returns all field errors for an empty message and invalid client id', async () => {
  const service = createChatMessagesService(createRepository())

  await assert.rejects(
    service.createMessage(userId, groupId, { content: '   ', clientMessageId: '!' }),
    (error: unknown) => error instanceof AppError
      && error.code === 'VALIDATION_ERROR'
      && Boolean(error.fieldErrors?.content)
      && Boolean(error.fieldErrors?.clientMessageId),
  )
})

test('counts Unicode code points when enforcing the 5000 character limit', async () => {
  const service = createChatMessagesService(createRepository())

  await assert.rejects(
    service.createMessage(userId, groupId, {
      content: '😀'.repeat(5_001),
      clientMessageId: 'unicode_0001',
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'VALIDATION_ERROR'
      && Boolean(error.fieldErrors?.content),
  )
})

test('requires an official group membership before reading messages', async () => {
  const service = createChatMessagesService(createRepository({ findMembership: async () => null }))

  await assert.rejects(
    service.getMessages(userId, groupId, undefined),
    (error: unknown) => error instanceof AppError && error.code === 'CHAT_GROUP_MEMBERSHIP_REQUIRED',
  )
})

test('loads 30 messages, applies joinedAt visibility and creates a stable next cursor', async () => {
  let capturedOptions: Parameters<ChatMessagesRepositoryContract['findMessages']>[1] | undefined
  const rows = Array.from({ length: CHAT_MESSAGE_PAGE_SIZE + 1 }, (_, index) => message(index))
  const service = createChatMessagesService(createRepository({
    findMessages: async (_groupId, options) => {
      capturedOptions = options
      return [...rows].reverse()
    },
  }))

  const result = await service.getMessages(userId, groupId, undefined)

  assert.equal(capturedOptions?.visibleAfter?.toISOString(), joinedAt.toISOString())
  assert.equal(capturedOptions?.limit, CHAT_MESSAGE_PAGE_SIZE + 1)
  assert.equal(result.messages.length, CHAT_MESSAGE_PAGE_SIZE)
  assert.ok(result.nextCursor)
  assert.ok(new Date(result.messages[0]!.createdAt) < new Date(result.messages.at(-1)!.createdAt))
})

test('loads the selected group message without bypassing joinedAt visibility', async () => {
  const selectedMessage = message(9)
  let receivedVisibleAfter: Date | undefined
  let receivedAnchor: { createdAt: Date; id: string } | undefined
  const service = createChatMessagesService(createRepository({
    findMessageById: async (_groupId, _messageId, visibleAfter) => {
      receivedVisibleAfter = visibleAfter
      return selectedMessage
    },
    findMessages: async (_groupId, options) => {
      receivedAnchor = options.anchor
      return [selectedMessage]
    },
  }))

  const result = await service.getMessages(
    userId,
    groupId,
    undefined,
    String(selectedMessage._id),
  )

  assert.equal(receivedVisibleAfter?.toISOString(), joinedAt.toISOString())
  assert.equal(receivedAnchor?.id, String(selectedMessage._id))
  assert.equal(result.messages[0]?.id, String(selectedMessage._id))
})

test('returns the stored message without creating a duplicate after a retry', async () => {
  const storedMessage = message(7)
  const duplicateError = Object.assign(new Error('duplicate'), { code: 11000 })
  let activityAt: Date | undefined
  const service = createChatMessagesService(createRepository({
    createMessage: async () => { throw duplicateError },
    findByClientMessageId: async () => storedMessage,
    touchGroup: async (_groupId, value) => { activityAt = value },
  }))

  const result = await service.createMessage(userId, groupId, {
    content: storedMessage.content,
    clientMessageId: storedMessage.clientMessageId,
  })

  assert.equal(result.created, false)
  assert.equal(result.message.id, String(storedMessage._id))
  assert.equal(activityAt?.toISOString(), storedMessage.createdAt.toISOString())
})

test('updates group activity using the newly created message timestamp', async () => {
  const createdMessage = message(11)
  let activityAt: Date | undefined
  const service = createChatMessagesService(createRepository({
    createMessage: async (input) => ({ ...createdMessage, ...input }),
    touchGroup: async (_groupId, value) => { activityAt = value },
  }))

  await service.createMessage(userId, groupId, {
    content: createdMessage.content,
    clientMessageId: createdMessage.clientMessageId,
  })

  assert.equal(activityAt?.toISOString(), createdMessage.createdAt.toISOString())
})
