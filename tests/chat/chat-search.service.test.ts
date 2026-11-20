import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createChatSearchService,
  type ChatSearchRepositoryContract,
} from '@/modules/chat/services/chat-search.service.js'
import type { GroupMessageSearchAccess } from '@/modules/chat/repositories/chat-search.repository.js'

const currentUserId = '000000000000000000000001'
const friendUserId = '000000000000000000000002'
const senderUserId = '000000000000000000000003'
const conversationId = '000000000000000000000004'
const groupId = '000000000000000000000005'
const joinedAt = new Date('2026-11-01T00:00:00.000Z')

test('searchMessages searches only accessible conversations and respects group history visibility', async () => {
  let receivedAccess: readonly GroupMessageSearchAccess[] = []
  const repository: ChatSearchRepositoryContract = {
    findAcceptedDirectConversations: async () => [{
      _id: conversationId,
      userAId: currentUserId,
      userBId: friendUserId,
    }],
    findGroupMemberships: async () => [{ groupId, joinedAt }],
    findActiveGroupsByIds: async () => [{
      _id: groupId,
      name: 'Nhóm học tập',
      historyVisibility: 'from_join',
    }],
    findUsersByIds: async () => [
      { _id: friendUserId, fullName: 'Bạn học', username: 'ban-hoc-1234' },
      { _id: senderUserId, fullName: 'Người gửi', username: 'nguoi-gui-1234' },
    ],
    searchDirectMessages: async (conversationIds, query, limit) => {
      assert.deepEqual(conversationIds, [conversationId])
      assert.equal(query, 'bài tập')
      assert.equal(limit, 30)
      return [{
        _id: '000000000000000000000006',
        conversationId,
        senderId: senderUserId,
        content: 'Bài tập trực tiếp',
        createdAt: new Date('2026-11-18T10:00:00.000Z'),
      }]
    },
    searchGroupMessages: async (access) => {
      receivedAccess = access
      return [{
        _id: '000000000000000000000007',
        groupId,
        senderId: senderUserId,
        content: 'Bài tập trong nhóm',
        createdAt: new Date('2026-11-19T10:00:00.000Z'),
      }]
    },
  }

  const results = await createChatSearchService(repository).searchMessages(currentUserId, ' bài tập ')

  assert.deepEqual(receivedAccess, [{ groupId, visibleAfter: joinedAt }])
  assert.deepEqual(results.map((result) => result.conversationType), ['group', 'direct'])
  assert.equal(results[0]?.conversationName, 'Nhóm học tập')
  assert.equal(results[1]?.conversationName, 'Bạn học')
})

test('searchMessages rejects an empty query with a field error', async () => {
  const repository = {} as ChatSearchRepositoryContract
  await assert.rejects(
    createChatSearchService(repository).searchMessages(currentUserId, '   '),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 422)
      assert.deepEqual((error as { fieldErrors?: unknown }).fieldErrors, {
        query: 'Vui lòng nhập từ khóa tìm kiếm.',
      })
      return true
    },
  )
})
