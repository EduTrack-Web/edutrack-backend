import { isValidObjectId } from 'mongoose'

import { AppError } from '../../../shared/errors/app-error.js'
import { chatRepository } from '../repositories/chat.repository.js'
import type {
  BlockedUserItem,
  ChatUserSummary,
  FriendRequestItem,
  FriendSearchResult,
  FriendshipSearchRelation,
} from '../types/chat.types.js'

const FRIEND_SEARCH_LIMIT = 20
const FRIEND_QUERY_MAX_LENGTH = 254

interface PersistedUser {
  _id: unknown
  fullName: string
  username: string
  avatarUrl?: string | null
}

interface PersistedFriendship {
  _id: unknown
  userAId: unknown
  userBId: unknown
  requestedById: unknown
  status: 'pending' | 'accepted'
  createdAt?: Date
}

interface PersistedBlock {
  blockerId: unknown
  blockedId: unknown
  createdAt?: Date
}

export interface ChatFriendsRepositoryContract {
  findChannelsByUserId: (userId: string) => PromiseLike<unknown[]>
  findActiveUserById: (userId: string) => PromiseLike<unknown | null>
  findActiveUserByExactIdentifier: (identifier: string) => PromiseLike<unknown | null>
  findActiveUsersByIds: (userIds: string[], query?: string, limit?: number) => PromiseLike<unknown[]>
  findUsersByIds: (userIds: string[]) => PromiseLike<unknown[]>
  findFriendshipByPair: (userAId: string, userBId: string) => PromiseLike<unknown | null>
  createFriendRequest: (userAId: string, userBId: string, requestedById: string) => PromiseLike<unknown>
  findPendingRequestsForUser: (userId: string) => PromiseLike<unknown[]>
  findAcceptedFriendshipsForUser: (userId: string) => PromiseLike<unknown[]>
  acceptFriendRequest: (requestId: string, userId: string) => PromiseLike<unknown | null>
  declineFriendRequest: (requestId: string, userId: string) => PromiseLike<unknown | null>
  deleteRelationshipBetween: (userAId: string, userBId: string) => PromiseLike<unknown>
  findBlocksForUser: (userId: string) => PromiseLike<unknown[]>
  findBlocksByBlocker: (userId: string) => PromiseLike<unknown[]>
  findBlockBetween: (userAId: string, userBId: string) => PromiseLike<unknown | null>
  upsertBlock: (blockerId: string, blockedId: string) => PromiseLike<unknown>
  deleteBlock: (blockerId: string, blockedId: string) => PromiseLike<{ deletedCount?: number }>
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

const canonicalPair = (firstUserId: string, secondUserId: string): [string, string] =>
  firstUserId.localeCompare(secondUserId) <= 0
    ? [firstUserId, secondUserId]
    : [secondUserId, firstUserId]

const otherUserId = (friendship: PersistedFriendship, userId: string): string =>
  String(friendship.userAId) === userId ? String(friendship.userBId) : String(friendship.userAId)

const normalizeQuery = (rawQuery: unknown): string => {
  if (typeof rawQuery !== 'string') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      query: 'Vui lòng nhập username hoặc email.',
    })
  }
  const query = rawQuery.trim().toLocaleLowerCase('vi-VN')
  if (!query) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      query: 'Vui lòng nhập username hoặc email.',
    })
  }
  if (query.length > FRIEND_QUERY_MAX_LENGTH) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      query: `Username hoặc email không được vượt quá ${FRIEND_QUERY_MAX_LENGTH} ký tự.`,
    })
  }
  return query
}

const normalizeTargetUserId = (input: unknown): string => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  }
  const payload = input as Record<string, unknown>
  if (!Object.keys(payload).every((key) => key === 'userId')
    || typeof payload.userId !== 'string'
    || !isValidObjectId(payload.userId)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      userId: 'Người dùng không hợp lệ.',
    })
  }
  return payload.userId
}

const requireRequestId = (requestId: string): void => {
  if (!isValidObjectId(requestId)) {
    throw new AppError(404, 'FRIEND_REQUEST_NOT_FOUND', 'Không tìm thấy lời mời kết bạn.')
  }
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000

export const createChatService = (repository: ChatFriendsRepositoryContract) => {
  const requireActiveUser = async (userId: string): Promise<void> => {
    const user = await repository.findActiveUserById(userId)
    if (!user) throw new AppError(403, 'ACTIVE_ACCOUNT_REQUIRED', 'Tài khoản không thể sử dụng chức năng này.')
  }

  const getBlockedUserIds = async (userId: string): Promise<Set<string>> => {
    const blocks = await repository.findBlocksForUser(userId)
    return new Set(blocks.map((rawBlock) => {
      const block = rawBlock as PersistedBlock
      return String(block.blockerId) === userId ? String(block.blockedId) : String(block.blockerId)
    }))
  }

  return {
    async getUserChannels(userId: string) {
      await requireActiveUser(userId)
      return repository.findChannelsByUserId(userId)
    },

    async getFriends(userId: string, rawQuery?: unknown): Promise<ChatUserSummary[]> {
      await requireActiveUser(userId)
      const [friendships, blockedUserIds] = await Promise.all([
        repository.findAcceptedFriendshipsForUser(userId),
        getBlockedUserIds(userId),
      ])
      const friendIds = friendships
        .map((item) => otherUserId(item as PersistedFriendship, userId))
        .filter((friendId) => !blockedUserIds.has(friendId))
      const query = typeof rawQuery === 'string' && rawQuery.trim()
        ? normalizeQuery(rawQuery)
        : undefined
      const users = await repository.findActiveUsersByIds(friendIds, query, FRIEND_SEARCH_LIMIT)
      return users.map(toUserSummary)
    },

    async searchUsers(userId: string, rawQuery: unknown): Promise<FriendSearchResult[]> {
      await requireActiveUser(userId)
      const query = normalizeQuery(rawQuery)
      const [friendships, pendingRequests, blockedUserIds, exactUser] = await Promise.all([
        repository.findAcceptedFriendshipsForUser(userId),
        repository.findPendingRequestsForUser(userId),
        getBlockedUserIds(userId),
        repository.findActiveUserByExactIdentifier(query),
      ])
      const friendIds = new Set(friendships.map((item) => otherUserId(item as PersistedFriendship, userId)))
      const pendingByUserId = new Map<string, FriendshipSearchRelation>()
      for (const item of pendingRequests) {
        const request = item as PersistedFriendship
        const targetId = otherUserId(request, userId)
        pendingByUserId.set(targetId, String(request.requestedById) === userId ? 'outgoing' : 'incoming')
      }
      const friendUsers = await repository.findActiveUsersByIds([...friendIds], query, FRIEND_SEARCH_LIMIT)
      const resultById = new Map<string, FriendSearchResult>()
      for (const rawUser of friendUsers) {
        const user = toUserSummary(rawUser)
        if (!blockedUserIds.has(user.id)) resultById.set(user.id, { ...user, relation: 'friend', exactMatch: false })
      }
      if (exactUser) {
        const user = toUserSummary(exactUser)
        if (user.id !== userId && !blockedUserIds.has(user.id)) {
          resultById.set(user.id, {
            ...user,
            relation: friendIds.has(user.id) ? 'friend' : (pendingByUserId.get(user.id) ?? 'none'),
            exactMatch: true,
          })
        }
      }
      return [...resultById.values()].sort((left, right) => left.username.localeCompare(right.username, 'vi'))
    },

    async sendFriendRequest(userId: string, input: unknown): Promise<FriendRequestItem> {
      await requireActiveUser(userId)
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
      }
      const payload = input as Record<string, unknown>
      if (!Object.keys(payload).every((key) => key === 'identifier')) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
      }
      const identifier = normalizeQuery(payload.identifier)
      const targetRaw = await repository.findActiveUserByExactIdentifier(identifier)
      if (!targetRaw) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản phù hợp.')
      const target = toUserSummary(targetRaw)
      if (target.id === userId) {
        throw new AppError(422, 'CANNOT_FRIEND_SELF', 'Bạn không thể gửi lời mời kết bạn cho chính mình.')
      }
      if (await repository.findBlockBetween(userId, target.id)) {
        throw new AppError(403, 'USER_INTERACTION_BLOCKED', 'Không thể tương tác với tài khoản này.')
      }
      const [userAId, userBId] = canonicalPair(userId, target.id)
      const existing = await repository.findFriendshipByPair(userAId, userBId)
      if (existing) {
        const relation = existing as PersistedFriendship
        if (relation.status === 'accepted') {
          throw new AppError(409, 'ALREADY_FRIENDS', 'Hai tài khoản đã là bạn bè.')
        }
        throw new AppError(409, 'FRIEND_REQUEST_ALREADY_EXISTS', 'Lời mời kết bạn đã tồn tại.')
      }
      try {
        const created = await repository.createFriendRequest(userAId, userBId, userId) as PersistedFriendship
        return {
          id: String(created._id),
          direction: 'outgoing',
          user: target,
          createdAt: created.createdAt?.toISOString() ?? new Date().toISOString(),
        }
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new AppError(409, 'FRIEND_REQUEST_ALREADY_EXISTS', 'Lời mời kết bạn đã tồn tại.')
        }
        throw error
      }
    },

    async getFriendRequests(userId: string): Promise<FriendRequestItem[]> {
      await requireActiveUser(userId)
      const [allRequests, blockedUserIds] = await Promise.all([
        repository.findPendingRequestsForUser(userId),
        getBlockedUserIds(userId),
      ])
      const requests = allRequests.filter((item) =>
        !blockedUserIds.has(otherUserId(item as PersistedFriendship, userId)))
      const userIds = requests.map((item) => otherUserId(item as PersistedFriendship, userId))
      const users = await repository.findActiveUsersByIds(userIds)
      const usersById = new Map(users.map((user) => {
        const summary = toUserSummary(user)
        return [summary.id, summary]
      }))
      return requests.flatMap((item) => {
        const request = item as PersistedFriendship
        const targetId = otherUserId(request, userId)
        const user = usersById.get(targetId)
        if (!user) return []
        return [{
          id: String(request._id),
          direction: String(request.requestedById) === userId ? 'outgoing' as const : 'incoming' as const,
          user,
          createdAt: request.createdAt?.toISOString() ?? new Date(0).toISOString(),
        }]
      })
    },

    async acceptFriendRequest(userId: string, requestId: string): Promise<ChatUserSummary> {
      await requireActiveUser(userId)
      requireRequestId(requestId)
      const accepted = await repository.acceptFriendRequest(requestId, userId)
      if (!accepted) throw new AppError(404, 'FRIEND_REQUEST_NOT_FOUND', 'Không tìm thấy lời mời kết bạn.')
      const friendship = accepted as PersistedFriendship
      const targetId = otherUserId(friendship, userId)
      if (await repository.findBlockBetween(userId, targetId)) {
        const [userAId, userBId] = canonicalPair(userId, targetId)
        await repository.deleteRelationshipBetween(userAId, userBId)
        throw new AppError(403, 'USER_INTERACTION_BLOCKED', 'Không thể tương tác với tài khoản này.')
      }
      const target = await repository.findActiveUserById(targetId)
      if (!target) {
        const [userAId, userBId] = canonicalPair(userId, targetId)
        await repository.deleteRelationshipBetween(userAId, userBId)
        throw new AppError(404, 'USER_NOT_FOUND', 'Tài khoản không còn khả dụng.')
      }
      return toUserSummary(target)
    },

    async declineFriendRequest(userId: string, requestId: string): Promise<void> {
      await requireActiveUser(userId)
      requireRequestId(requestId)
      const deleted = await repository.declineFriendRequest(requestId, userId)
      if (!deleted) throw new AppError(404, 'FRIEND_REQUEST_NOT_FOUND', 'Không tìm thấy lời mời kết bạn.')
    },

    async getBlockedUsers(userId: string): Promise<BlockedUserItem[]> {
      await requireActiveUser(userId)
      const blocks = await repository.findBlocksByBlocker(userId)
      const userIds = blocks.map((item) => String((item as PersistedBlock).blockedId))
      const users = await repository.findUsersByIds(userIds)
      const usersById = new Map(users.map((user) => {
        const summary = toUserSummary(user)
        return [summary.id, summary]
      }))
      return blocks.flatMap((item) => {
        const block = item as PersistedBlock
        const user = usersById.get(String(block.blockedId))
        return user ? [{ ...user, blockedAt: block.createdAt?.toISOString() ?? new Date(0).toISOString() }] : []
      })
    },

    async blockUser(userId: string, input: unknown): Promise<BlockedUserItem> {
      await requireActiveUser(userId)
      const targetUserId = normalizeTargetUserId(input)
      if (targetUserId === userId) {
        throw new AppError(422, 'CANNOT_BLOCK_SELF', 'Bạn không thể chặn chính mình.')
      }
      const target = await repository.findActiveUserById(targetUserId)
      if (!target) throw new AppError(404, 'USER_NOT_FOUND', 'Tài khoản không còn khả dụng.')
      const block = await repository.upsertBlock(userId, targetUserId) as PersistedBlock
      const [userAId, userBId] = canonicalPair(userId, targetUserId)
      await repository.deleteRelationshipBetween(userAId, userBId)
      return {
        ...toUserSummary(target),
        blockedAt: block.createdAt?.toISOString() ?? new Date().toISOString(),
      }
    },

    async unblockUser(userId: string, targetUserId: string): Promise<void> {
      await requireActiveUser(userId)
      if (!isValidObjectId(targetUserId)) {
        throw new AppError(404, 'BLOCK_NOT_FOUND', 'Không tìm thấy tài khoản bị chặn.')
      }
      const result = await repository.deleteBlock(userId, targetUserId)
      if (!result.deletedCount) throw new AppError(404, 'BLOCK_NOT_FOUND', 'Không tìm thấy tài khoản bị chặn.')
    },
  }
}

export const chatService = createChatService(chatRepository)
