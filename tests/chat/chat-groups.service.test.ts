import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import {
  createChatGroupsService,
  type ChatGroupsRepositoryContract,
} from '@/modules/chat/services/chat-groups.service.js'

const ownerId = new Types.ObjectId().toString()
const friendId = new Types.ObjectId().toString()
const strangerId = new Types.ObjectId().toString()
const groupId = new Types.ObjectId().toString()
const now = new Date('2026-11-09T03:00:00.000Z')
const token = 'a'.repeat(43)

const user = (id: string, username: string) => ({
  _id: new Types.ObjectId(id),
  fullName: username,
  username,
})

const group = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(groupId),
  name: 'Nhóm học tập',
  description: 'Cùng nhau ôn tập',
  ownerId: new Types.ObjectId(ownerId),
  inviteLinksEnabled: true,
  historyVisibility: 'from_join' as const,
  status: 'active',
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const createRepository = (
  overrides: Partial<ChatGroupsRepositoryContract> = {},
): ChatGroupsRepositoryContract => ({
  findActiveUserById: async (userId) => user(userId, userId === ownerId ? 'owner' : 'member'),
  findActiveUsersByIds: async (userIds) => userIds.map((userId) => user(userId, userId)),
  findAcceptedFriendships: async () => [],
  findBlocksBetween: async () => [],
  createGroup: async () => group(),
  insertMembers: async () => [],
  insertInvitations: async () => [],
  createInviteLink: async (input) => input,
  revokeActiveInviteLinks: async () => ({}),
  deleteGroupBundle: async () => undefined,
  findMembershipsByUser: async () => [],
  findGroupsByIds: async () => [],
  findMembersByGroupIds: async () => [],
  findPendingInvitationsByGroupIds: async () => [],
  findGroupById: async () => group(),
  findMembership: async () => null,
  findMembersByGroupId: async () => [],
  findPendingInvitationsByGroupId: async () => [],
  findInviteLinkByTokenHash: async () => null,
  findPendingInvitation: async () => null,
  createMember: async (input) => input,
  deleteMember: async () => ({}),
  acceptInvitation: async () => null,
  ...overrides,
})

const createService = (repository: ChatGroupsRepositoryContract) =>
  createChatGroupsService(repository, {
    now: () => new Date(now),
    createToken: () => token,
    frontendUrl: 'http://localhost:5173',
  })

test('requires at least two selected users and validates all group fields', async () => {
  const service = createService(createRepository())

  await assert.rejects(
    service.createGroup(ownerId, {
      name: 'A',
      description: 'x'.repeat(501),
      participantIds: [friendId],
      historyVisibility: 'invalid',
    }),
    (error: unknown) => error instanceof AppError
      && error.code === 'VALIDATION_ERROR'
      && Boolean(error.fieldErrors?.name)
      && Boolean(error.fieldErrors?.description)
      && Boolean(error.fieldErrors?.participantIds)
      && Boolean(error.fieldErrors?.historyVisibility),
  )
})

test('adds friends immediately, keeps strangers invited and creates one seven-day link', async () => {
  let insertedMembers: Array<{ userId: string; role: string }> = []
  let insertedInvitations: Array<{ inviteeId: string }> = []
  let inviteExpiresAt: Date | undefined
  const repository = createRepository({
    findAcceptedFriendships: async () => [{ userAId: ownerId, userBId: friendId }],
    insertMembers: async (members) => { insertedMembers = members; return [] },
    insertInvitations: async (invitations) => { insertedInvitations = invitations; return [] },
    createInviteLink: async (input) => { inviteExpiresAt = input.expiresAt; return input },
  })

  const result = await createService(repository).createGroup(ownerId, {
    name: '  Nhóm   học tập  ',
    description: '',
    participantIds: [friendId, strangerId],
  })

  assert.deepEqual(insertedMembers.map((item) => [item.userId, item.role]), [
    [ownerId, 'owner'],
    [friendId, 'member'],
  ])
  assert.deepEqual(insertedInvitations.map((item) => item.inviteeId), [strangerId])
  assert.equal(result.group.memberCount, 2)
  assert.equal(result.group.pendingInvitationCount, 1)
  assert.equal(result.group.historyVisibility, 'from_join')
  assert.equal(result.invite.url, `http://localhost:5173/chat/join/${token}`)
  assert.equal(inviteExpiresAt?.getTime(), now.getTime() + 7 * 24 * 60 * 60 * 1_000)
})

test('rejects group creation when either account has blocked the other', async () => {
  const repository = createRepository({
    findBlocksBetween: async () => [{ blockerId: ownerId, blockedId: strangerId }],
  })

  await assert.rejects(
    createService(repository).createGroup(ownerId, {
      name: 'Nhóm học tập',
      participantIds: [friendId, strangerId],
    }),
    (error: unknown) => error instanceof AppError && error.code === 'USER_INTERACTION_BLOCKED',
  )
})

test('distinguishes an expired invite link from an invalid link', async () => {
  const repository = createRepository({
    findInviteLinkByTokenHash: async () => ({
      groupId,
      expiresAt: new Date(now.getTime() - 1),
      revokedAt: null,
    }),
  })

  await assert.rejects(
    createService(repository).previewInvite(ownerId, token),
    (error: unknown) => error instanceof AppError && error.code === 'GROUP_INVITE_EXPIRED',
  )
})

test('joins through the single invite link and accepts a matching direct invitation', async () => {
  let createdMember: { groupId: string; userId: string; role: string } | undefined
  let acceptedInviteeId = ''
  const repository = createRepository({
    findInviteLinkByTokenHash: async () => ({
      groupId,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    }),
    createMember: async (input) => { createdMember = input; return input },
    acceptInvitation: async (_groupId, inviteeId) => { acceptedInviteeId = inviteeId; return {} },
    findMembersByGroupId: async () => [
      { groupId, userId: ownerId, role: 'owner', joinedAt: now },
      { groupId, userId: strangerId, role: 'member', joinedAt: now },
    ],
  })

  const result = await createService(repository).joinByInvite(strangerId, token)

  assert.deepEqual(createdMember, { groupId, userId: strangerId, role: 'member', joinedAt: now })
  assert.equal(acceptedInviteeId, strangerId)
  assert.equal(result.memberCount, 2)
  assert.equal(result.role, 'member')
})

test('does not add an existing member twice', async () => {
  const repository = createRepository({
    findInviteLinkByTokenHash: async () => ({
      groupId,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    }),
    findMembership: async () => ({ groupId, userId: strangerId, role: 'member', joinedAt: now }),
  })

  await assert.rejects(
    createService(repository).joinByInvite(strangerId, token),
    (error: unknown) => error instanceof AppError && error.code === 'ALREADY_GROUP_MEMBER',
  )
})

test('removes the new membership if accepting the matching invitation fails', async () => {
  let removedUserId = ''
  const repository = createRepository({
    findInviteLinkByTokenHash: async () => ({
      groupId,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
    }),
    acceptInvitation: async () => { throw new Error('database unavailable') },
    deleteMember: async (_groupId, userId) => { removedUserId = userId; return {} },
  })

  await assert.rejects(createService(repository).joinByInvite(strangerId, token))
  assert.equal(removedUserId, strangerId)
})
