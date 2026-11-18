import { createHash, randomBytes } from 'node:crypto'

import { isValidObjectId } from 'mongoose'

import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'
import { CHAT_GROUP_INVITE_LIFETIME_MS, CHAT_GROUP_PERMISSIONS, type ChatGroupRole } from '@/modules/chat/config/chat.config.js'
import { chatGroupsRepository } from '@/modules/chat/repositories/chat-groups.repository.js'
import type {
  ChatGroupDetail,
  ChatGroupInvitePreview,
  ChatGroupInviteResult,
  ChatGroupMemberItem,
  ChatGroupSummary,
  ChatUserSummary,
} from '@/modules/chat/types/chat.types.js'
import { validateCreateChatGroup } from '@/modules/chat/validations/chat-groups.validation.js'

interface PersistedUser {
  _id: unknown
  fullName: string
  username: string
  avatarUrl?: string | null
}

interface PersistedGroup {
  _id: unknown
  name: string
  description: string
  ownerId: unknown
  inviteLinksEnabled: boolean
  historyVisibility: 'from_join' | 'all'
  createdAt?: Date
  updatedAt?: Date
}

interface PersistedMembership {
  groupId: unknown
  userId: unknown
  role: ChatGroupRole
  joinedAt: Date
}

interface PersistedInvitation {
  _id: unknown
  groupId: unknown
  inviteeId: unknown
  createdAt?: Date
}

interface PersistedFriendship {
  userAId: unknown
  userBId: unknown
}

interface PersistedInviteLink {
  groupId: unknown
  expiresAt: Date
  revokedAt?: Date | null
}

export interface ChatGroupsRepositoryContract {
  findActiveUserById: (userId: string) => PromiseLike<unknown | null>
  findActiveUsersByIds: (userIds: readonly string[]) => PromiseLike<unknown[]>
  findAcceptedFriendships: (userId: string, targetIds: readonly string[]) => PromiseLike<unknown[]>
  findBlocksBetween: (userId: string, targetIds: readonly string[]) => PromiseLike<unknown[]>
  createGroup: (input: {
    name: string
    description: string
    ownerId: string
    historyVisibility: 'from_join' | 'all'
  }) => PromiseLike<unknown>
  insertMembers: (members: Array<{
    groupId: string
    userId: string
    role: ChatGroupRole
    joinedAt: Date
  }>) => PromiseLike<unknown>
  insertInvitations: (invitations: Array<{
    groupId: string
    inviteeId: string
    invitedById: string
  }>) => PromiseLike<unknown>
  createInviteLink: (input: {
    groupId: string
    tokenHash: string
    createdById: string
    expiresAt: Date
  }) => PromiseLike<unknown>
  revokeActiveInviteLinks: (groupId: string, revokedAt: Date) => PromiseLike<unknown>
  deleteGroupBundle: (groupId: string) => PromiseLike<void>
  findMembershipsByUser: (userId: string) => PromiseLike<unknown[]>
  findGroupsByIds: (groupIds: readonly string[]) => PromiseLike<unknown[]>
  findMembersByGroupIds: (groupIds: readonly string[]) => PromiseLike<unknown[]>
  findPendingInvitationsByGroupIds: (groupIds: readonly string[]) => PromiseLike<unknown[]>
  findGroupById: (groupId: string) => PromiseLike<unknown | null>
  findMembership: (groupId: string, userId: string) => PromiseLike<unknown | null>
  findMembersByGroupId: (groupId: string) => PromiseLike<unknown[]>
  findPendingInvitationsByGroupId: (groupId: string) => PromiseLike<unknown[]>
  findInviteLinkByTokenHash: (tokenHash: string) => PromiseLike<unknown | null>
  findPendingInvitation: (groupId: string, inviteeId: string) => PromiseLike<unknown | null>
  createMember: (input: {
    groupId: string
    userId: string
    role: ChatGroupRole
    joinedAt: Date
  }) => PromiseLike<unknown>
  deleteMember: (groupId: string, userId: string) => PromiseLike<unknown>
  acceptInvitation: (groupId: string, inviteeId: string, acceptedAt: Date) => PromiseLike<unknown>
}

interface ChatGroupsServiceOptions {
  now?: () => Date
  createToken?: () => string
  frontendUrl?: string
}

const toUserSummary = (rawUser: unknown): ChatUserSummary => {
  const user = rawUser as PersistedUser
  return {
    id: String(user._id),
    fullName: user.fullName,
    username: user.username,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
  }
}

const friendshipTargetId = (rawFriendship: unknown, userId: string): string => {
  const friendship = rawFriendship as PersistedFriendship
  return String(friendship.userAId) === userId ? String(friendship.userBId) : String(friendship.userAId)
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

const requireGroupId = (groupId: string): void => {
  if (!isValidObjectId(groupId)) throw new AppError(404, 'CHAT_GROUP_NOT_FOUND', 'Không tìm thấy nhóm trò chuyện.')
}

const normalizeInviteToken = (rawToken: string): string => {
  const token = rawToken.trim()
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) {
    throw new AppError(404, 'GROUP_INVITE_INVALID', 'Liên kết tham gia không hợp lệ.')
  }
  return token
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000

export const createChatGroupsService = (
  repository: ChatGroupsRepositoryContract,
  options: ChatGroupsServiceOptions = {},
) => {
  const now = options.now ?? (() => new Date())
  const createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'))
  const frontendUrl = (options.frontendUrl ?? env.frontendUrl).replace(/\/$/u, '')

  const requireActiveUser = async (userId: string): Promise<void> => {
    if (!await repository.findActiveUserById(userId)) {
      throw new AppError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'Tài khoản không thể sử dụng chức năng này.')
    }
  }

  const createInvite = async (groupId: string, userId: string): Promise<ChatGroupInviteResult> => {
    const token = createToken()
    const expiresAt = new Date(now().getTime() + CHAT_GROUP_INVITE_LIFETIME_MS)
    await repository.createInviteLink({ groupId, tokenHash: hashToken(token), createdById: userId, expiresAt })
    return { url: `${frontendUrl}/chat/join/${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() }
  }

  const loadGroupCounts = async (groupIds: readonly string[]) => {
    const [members, invitations] = await Promise.all([
      repository.findMembersByGroupIds(groupIds),
      repository.findPendingInvitationsByGroupIds(groupIds),
    ])
    const memberCounts = new Map<string, number>()
    const invitationCounts = new Map<string, number>()
    for (const rawMember of members) {
      const groupId = String((rawMember as PersistedMembership).groupId)
      memberCounts.set(groupId, (memberCounts.get(groupId) ?? 0) + 1)
    }
    for (const rawInvitation of invitations) {
      const groupId = String((rawInvitation as PersistedInvitation).groupId)
      invitationCounts.set(groupId, (invitationCounts.get(groupId) ?? 0) + 1)
    }
    return { memberCounts, invitationCounts }
  }

  const toSummary = (
    group: PersistedGroup,
    role: ChatGroupRole,
    memberCount: number,
    pendingInvitationCount: number,
  ): ChatGroupSummary => ({
    id: String(group._id),
    name: group.name,
    description: group.description,
    role,
    memberCount,
    pendingInvitationCount,
    historyVisibility: group.historyVisibility,
    inviteLinksEnabled: group.inviteLinksEnabled,
    createdAt: group.createdAt?.toISOString() ?? new Date(0).toISOString(),
    updatedAt: group.updatedAt?.toISOString() ?? new Date(0).toISOString(),
  })

  const requireGroupMembership = async (groupId: string, userId: string) => {
    requireGroupId(groupId)
    const [groupRaw, membershipRaw] = await Promise.all([
      repository.findGroupById(groupId),
      repository.findMembership(groupId, userId),
    ])
    if (!groupRaw || !membershipRaw) {
      throw new AppError(404, 'CHAT_GROUP_NOT_FOUND', 'Không tìm thấy nhóm trò chuyện.')
    }
    return { group: groupRaw as PersistedGroup, membership: membershipRaw as PersistedMembership }
  }

  const resolveInvite = async (rawToken: string) => {
    const token = normalizeInviteToken(rawToken)
    const linkRaw = await repository.findInviteLinkByTokenHash(hashToken(token))
    if (!linkRaw) throw new AppError(404, 'GROUP_INVITE_INVALID', 'Liên kết tham gia không hợp lệ.')
    const link = linkRaw as PersistedInviteLink
    const groupRaw = await repository.findGroupById(String(link.groupId))
    if (!groupRaw) throw new AppError(404, 'GROUP_INVITE_INVALID', 'Liên kết tham gia không hợp lệ.')
    const group = groupRaw as PersistedGroup
    if (!group.inviteLinksEnabled) {
      throw new AppError(410, 'GROUP_INVITES_DISABLED', 'Nhóm đã tắt tham gia bằng liên kết.')
    }
    if (link.revokedAt) throw new AppError(410, 'GROUP_INVITE_REVOKED', 'Liên kết tham gia đã bị thu hồi.')
    if (link.expiresAt.getTime() <= now().getTime()) {
      throw new AppError(410, 'GROUP_INVITE_EXPIRED', 'Liên kết tham gia đã hết hạn.')
    }
    return group
  }

  return {
    async createGroup(userId: string, input: unknown): Promise<{ group: ChatGroupDetail; invite: ChatGroupInviteResult }> {
      await requireActiveUser(userId)
      const payload = validateCreateChatGroup(input)
      if (payload.participantIds.includes(userId)) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
          participantIds: 'Không chọn tài khoản của chính bạn làm thành viên được mời.',
        })
      }
      const [users, friendships, blocks] = await Promise.all([
        repository.findActiveUsersByIds(payload.participantIds),
        repository.findAcceptedFriendships(userId, payload.participantIds),
        repository.findBlocksBetween(userId, payload.participantIds),
      ])
      if (users.length !== payload.participantIds.length) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
          participantIds: 'Một hoặc nhiều tài khoản không còn khả dụng.',
        })
      }
      if (blocks.length > 0) {
        throw new AppError(403, 'USER_INTERACTION_BLOCKED', 'Không thể thêm một hoặc nhiều tài khoản đã bị chặn.')
      }
      const friendIds = new Set(friendships.map((item) => friendshipTargetId(item, userId)))
      const memberUserIds = payload.participantIds.filter((targetId) => friendIds.has(targetId))
      const invitedUserIds = payload.participantIds.filter((targetId) => !friendIds.has(targetId))
      const createdAt = now()
      let groupId: string | undefined
      try {
        const group = await repository.createGroup({
          name: payload.name,
          description: payload.description,
          ownerId: userId,
          historyVisibility: payload.historyVisibility,
        }) as PersistedGroup
        groupId = String(group._id)
        await repository.insertMembers([
          { groupId, userId, role: 'owner', joinedAt: createdAt },
          ...memberUserIds.map((targetId) => ({ groupId: groupId as string, userId: targetId, role: 'member' as const, joinedAt: createdAt })),
        ])
        const createdInvitations = await repository.insertInvitations(invitedUserIds.map((inviteeId) => ({
          groupId: groupId as string,
          inviteeId,
          invitedById: userId,
        }))) as unknown[]
        const invite = await createInvite(groupId, userId)
        const usersById = new Map(users.map((rawUser) => {
          const summary = toUserSummary(rawUser)
          return [summary.id, summary]
        }))
        const ownerRaw = await repository.findActiveUserById(userId)
        if (!ownerRaw) throw new AppError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'Tài khoản không còn khả dụng.')
        const owner = toUserSummary(ownerRaw)
        const members: ChatGroupMemberItem[] = [
          { role: 'owner', joinedAt: createdAt.toISOString(), user: owner },
          ...memberUserIds.flatMap((targetId) => {
            const user = usersById.get(targetId)
            return user ? [{ role: 'member' as const, joinedAt: createdAt.toISOString(), user }] : []
          }),
        ]
        const invitationIdsByUserId = new Map(createdInvitations.map((rawInvitation) => {
          const invitation = rawInvitation as PersistedInvitation
          return [String(invitation.inviteeId), String(invitation._id)]
        }))
        const invitations = invitedUserIds.flatMap((targetId) => {
          const user = usersById.get(targetId)
          return user ? [{
            id: invitationIdsByUserId.get(targetId) ?? targetId,
            createdAt: createdAt.toISOString(),
            user,
          }] : []
        })
        return {
          group: {
            ...toSummary(group, 'owner', members.length, invitations.length),
            members,
            invitations,
            canManageInvites: true,
          },
          invite,
        }
      } catch (error) {
        if (groupId) await repository.deleteGroupBundle(groupId)
        throw error
      }
    },

    async getGroups(userId: string): Promise<ChatGroupSummary[]> {
      await requireActiveUser(userId)
      const memberships = await repository.findMembershipsByUser(userId)
      const groupIds = memberships.map((item) => String((item as PersistedMembership).groupId))
      if (groupIds.length === 0) return []
      const [groups, counts] = await Promise.all([
        repository.findGroupsByIds(groupIds),
        loadGroupCounts(groupIds),
      ])
      const membershipByGroupId = new Map(memberships.map((item) => {
        const membership = item as PersistedMembership
        return [String(membership.groupId), membership]
      }))
      return groups.map((rawGroup) => {
        const group = rawGroup as PersistedGroup
        const groupId = String(group._id)
        const membership = membershipByGroupId.get(groupId)
        return toSummary(
          group,
          membership?.role ?? 'member',
          counts.memberCounts.get(groupId) ?? 0,
          counts.invitationCounts.get(groupId) ?? 0,
        )
      }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    },

    async getGroup(userId: string, groupId: string): Promise<ChatGroupDetail> {
      await requireActiveUser(userId)
      const { group, membership } = await requireGroupMembership(groupId, userId)
      const [membersRaw, invitationsRaw] = await Promise.all([
        repository.findMembersByGroupId(groupId),
        repository.findPendingInvitationsByGroupId(groupId),
      ])
      const canManageInvites = CHAT_GROUP_PERMISSIONS[membership.role].canManageInvites
      const visibleInvitations = canManageInvites ? invitationsRaw : []
      const userIds = [
        ...membersRaw.map((item) => String((item as PersistedMembership).userId)),
        ...visibleInvitations.map((item) => String((item as PersistedInvitation).inviteeId)),
      ]
      const users = await repository.findActiveUsersByIds([...new Set(userIds)])
      const usersById = new Map(users.map((rawUser) => {
        const user = toUserSummary(rawUser)
        return [user.id, user]
      }))
      const members = membersRaw.flatMap((rawMember) => {
        const member = rawMember as PersistedMembership
        const user = usersById.get(String(member.userId))
        return user ? [{ role: member.role, joinedAt: member.joinedAt.toISOString(), user }] : []
      })
      const invitations = visibleInvitations.flatMap((rawInvitation) => {
        const invitation = rawInvitation as PersistedInvitation
        const user = usersById.get(String(invitation.inviteeId))
        return user ? [{
          id: String(invitation._id),
          createdAt: invitation.createdAt?.toISOString() ?? new Date(0).toISOString(),
          user,
        }] : []
      })
      return {
        ...toSummary(group, membership.role, members.length, invitationsRaw.length),
        members,
        invitations,
        canManageInvites,
      }
    },

    async createInviteLink(userId: string, groupId: string): Promise<ChatGroupInviteResult> {
      await requireActiveUser(userId)
      const { group, membership } = await requireGroupMembership(groupId, userId)
      if (!CHAT_GROUP_PERMISSIONS[membership.role].canManageJoinLinks) {
        throw new AppError(403, 'GROUP_PERMISSION_DENIED', 'Bạn không có quyền tạo liên kết tham gia nhóm.')
      }
      if (!group.inviteLinksEnabled) {
        throw new AppError(409, 'GROUP_INVITES_DISABLED', 'Nhóm đã tắt tham gia bằng liên kết.')
      }
      const revokedAt = now()
      await repository.revokeActiveInviteLinks(groupId, revokedAt)
      return createInvite(groupId, userId)
    },

    async previewInvite(userId: string, rawToken: string): Promise<ChatGroupInvitePreview> {
      await requireActiveUser(userId)
      const group = await resolveInvite(rawToken)
      const groupId = String(group._id)
      const [membership, invitation, members] = await Promise.all([
        repository.findMembership(groupId, userId),
        repository.findPendingInvitation(groupId, userId),
        repository.findMembersByGroupId(groupId),
      ])
      return {
        group: {
          id: groupId,
          name: group.name,
          description: group.description,
          memberCount: members.length,
          historyVisibility: group.historyVisibility,
        },
        alreadyMember: Boolean(membership),
        invitedDirectly: Boolean(invitation),
      }
    },

    async joinByInvite(userId: string, rawToken: string): Promise<ChatGroupSummary> {
      await requireActiveUser(userId)
      const group = await resolveInvite(rawToken)
      const groupId = String(group._id)
      if (await repository.findMembership(groupId, userId)) {
        throw new AppError(409, 'ALREADY_GROUP_MEMBER', 'Bạn đã là thành viên của nhóm này.')
      }
      const joinedAt = now()
      try {
        await repository.createMember({ groupId, userId, role: 'member', joinedAt })
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new AppError(409, 'ALREADY_GROUP_MEMBER', 'Bạn đã là thành viên của nhóm này.')
        }
        throw error
      }
      try {
        await repository.acceptInvitation(groupId, userId, joinedAt)
      } catch (error) {
        await repository.deleteMember(groupId, userId)
        throw error
      }
      const [members, invitations] = await Promise.all([
        repository.findMembersByGroupId(groupId),
        repository.findPendingInvitationsByGroupId(groupId),
      ])
      return toSummary(group, 'member', members.length, invitations.length)
    },
  }
}

export const chatGroupsService = createChatGroupsService(chatGroupsRepository)
