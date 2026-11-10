import { isValidObjectId } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import {
  NOTE_SEARCH_QUERY_MAX_LENGTH,
  NOTE_SHARE_SEARCH_LIMIT,
  NOTE_SHARE_SEARCH_MIN_LENGTH,
} from '@/modules/notes/config/notes.config.js'
import { noteSharesRepository } from '@/modules/notes/repositories/note-shares.repository.js'
import { notesRepository } from '@/modules/notes/repositories/notes.repository.js'
import type {
  NoteAccess,
  NoteCollaborator,
  NotePermission,
  NoteShareUser,
} from '@/modules/notes/types/notes.types.js'

interface PersistedAccessNote {
  _id: unknown
  ownerId: unknown
}

interface PersistedShare {
  userId: unknown
  permission: NotePermission
}

interface PersistedUser {
  _id: unknown
  fullName: string
  username: string
  avatarUrl?: string | null
  status?: string
}

export interface NoteSharesRepositoryContract {
  findShare: (noteId: string, userId: string) => PromiseLike<unknown | null>
  findSharedNoteIds: (userId: string) => PromiseLike<string[]>
  findSharesForUser: (userId: string) => PromiseLike<unknown[]>
  findSharesByNoteId: (noteId: string) => PromiseLike<unknown[]>
  searchActiveUsers: (query: string, excludedUserId: string, limit: number) => PromiseLike<unknown[]>
  findActiveUserById: (userId: string) => PromiseLike<unknown | null>
  findUserById: (userId: string) => PromiseLike<unknown | null>
  upsertShare: (
    noteId: string,
    userId: string,
    permission: NotePermission,
    grantedBy: string,
  ) => PromiseLike<unknown>
  deleteShare: (noteId: string, userId: string) => PromiseLike<unknown>
  deleteSharesForNote: (noteId: string) => PromiseLike<unknown>
}

export interface NotesAccessRepositoryContract {
  findActiveNoteById: (noteId: string) => PromiseLike<unknown | null>
}

export interface ResolvedNoteAccess {
  note: unknown
  access: NoteAccess
}

const requireNoteId = (noteId: string): void => {
  if (!isValidObjectId(noteId)) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
}

const toShareUser = (user: PersistedUser): NoteShareUser => ({
  id: String(user._id),
  fullName: user.fullName,
  username: user.username,
  ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
})

const normalizePermission = (value: unknown): NotePermission => {
  if (value !== 'view' && value !== 'edit') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      permission: 'Quyền truy cập phải là chỉ xem hoặc chỉnh sửa.',
    })
  }
  return value
}

const normalizeShareInput = (input: unknown): { userId: string; permission: NotePermission } => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  }
  const payload = input as Record<string, unknown>
  if (!Object.keys(payload).every((key) => ['userId', 'permission'].includes(key))
    || typeof payload.userId !== 'string'
    || !isValidObjectId(payload.userId)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      userId: 'Người được chia sẻ không hợp lệ.',
    })
  }
  return { userId: payload.userId, permission: normalizePermission(payload.permission) }
}

export const createNoteSharesService = (
  repository: NoteSharesRepositoryContract,
  noteRepository: NotesAccessRepositoryContract,
) => {
  const getNoteAccess = async (userId: string, noteId: string): Promise<ResolvedNoteAccess | null> => {
    requireNoteId(noteId)
    const note = await noteRepository.findActiveNoteById(noteId)
    if (!note) return null
    const persistedNote = note as PersistedAccessNote
    if (String(persistedNote.ownerId) === userId) {
      return {
        note,
        access: { role: 'owner', canEdit: true, canManageAccess: true, isSharedWithMe: false },
      }
    }
    const share = await repository.findShare(noteId, userId)
    if (!share) return null
    const permission = (share as PersistedShare).permission
    return {
      note,
      access: {
        role: permission,
        canEdit: permission === 'edit',
        canManageAccess: true,
        isSharedWithMe: true,
      },
    }
  }

  const requireManageAccess = async (userId: string, noteId: string): Promise<ResolvedNoteAccess> => {
    const resolved = await getNoteAccess(userId, noteId)
    if (!resolved) throw new AppError(404, 'NOTE_NOT_FOUND', 'Không tìm thấy ghi chú.')
    if (!resolved.access.canManageAccess) {
      throw new AppError(403, 'NOTE_SHARE_FORBIDDEN', 'Bạn không có quyền quản lý chia sẻ ghi chú này.')
    }
    return resolved
  }

  return {
    getNoteAccess,

    getSharedNoteIds: (userId: string): PromiseLike<string[]> => repository.findSharedNoteIds(userId),

    async getSharedAccessByNoteId(userId: string): Promise<Record<string, NoteAccess>> {
      const shares = await repository.findSharesForUser(userId)
      return Object.fromEntries(shares.map((rawShare) => {
        const share = rawShare as PersistedShare & { noteId: unknown }
        return [String(share.noteId), {
          role: share.permission,
          canEdit: share.permission === 'edit',
          canManageAccess: true,
          isSharedWithMe: true,
        } satisfies NoteAccess]
      }))
    },

    deleteSharesForNote: (noteId: string): PromiseLike<unknown> => repository.deleteSharesForNote(noteId),

    async searchUsers(userId: string, noteId: string, rawQuery: unknown): Promise<NoteShareUser[]> {
      const resolved = await requireManageAccess(userId, noteId)
      if (typeof rawQuery !== 'string') return []
      const query = rawQuery.trim().replace(/\s+/gu, ' ')
      if (query.length < NOTE_SHARE_SEARCH_MIN_LENGTH) return []
      if (query.length > NOTE_SEARCH_QUERY_MAX_LENGTH) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
          query: `Từ khóa không được vượt quá ${NOTE_SEARCH_QUERY_MAX_LENGTH} ký tự.`,
        })
      }
      const ownerId = String((resolved.note as PersistedAccessNote).ownerId)
      const users = await repository.searchActiveUsers(query, userId, NOTE_SHARE_SEARCH_LIMIT)
      return users
        .map((candidate) => candidate as PersistedUser)
        .filter((candidate) => String(candidate._id) !== ownerId)
        .map(toShareUser)
    },

    async getCollaborators(userId: string, noteId: string): Promise<{
      owner: NoteShareUser
      collaborators: NoteCollaborator[]
    }> {
      const resolved = await requireManageAccess(userId, noteId)
      const ownerId = String((resolved.note as PersistedAccessNote).ownerId)
      const owner = await repository.findUserById(ownerId)
      if (!owner) throw new AppError(404, 'NOTE_OWNER_NOT_FOUND', 'Không tìm thấy chủ sở hữu ghi chú.')
      const shares = await repository.findSharesByNoteId(noteId)
      const collaborators = shares.flatMap((rawShare): NoteCollaborator[] => {
        const share = rawShare as PersistedShare
        if (typeof share.userId !== 'object' || share.userId === null || !('_id' in share.userId)) return []
        const collaborator = share.userId as PersistedUser
        if (collaborator.status && collaborator.status !== 'active') return []
        return [{
          ...toShareUser(collaborator),
          permission: share.permission,
          isCurrentUser: String(collaborator._id) === userId,
        }]
      })
      return { owner: toShareUser(owner as PersistedUser), collaborators }
    },

    async setCollaborator(userId: string, noteId: string, input: unknown): Promise<NoteCollaborator> {
      const resolved = await requireManageAccess(userId, noteId)
      const { userId: targetUserId, permission } = normalizeShareInput(input)
      const ownerId = String((resolved.note as PersistedAccessNote).ownerId)
      if (targetUserId === ownerId) {
        throw new AppError(422, 'NOTE_OWNER_PERMISSION_IMMUTABLE', 'Không thể thay đổi quyền của chủ sở hữu.')
      }
      if (targetUserId === userId && resolved.access.role !== 'owner') {
        throw new AppError(403, 'NOTE_SELF_PERMISSION_IMMUTABLE', 'Bạn không thể tự thay đổi quyền của chính mình.')
      }
      const targetUser = await repository.findActiveUserById(targetUserId)
      if (!targetUser) throw new AppError(404, 'SHARE_USER_NOT_FOUND', 'Không tìm thấy người dùng phù hợp.')
      await repository.upsertShare(noteId, targetUserId, permission, userId)
      return {
        ...toShareUser(targetUser as PersistedUser),
        permission,
        isCurrentUser: targetUserId === userId,
      }
    },

    async removeCollaborator(userId: string, noteId: string, targetUserId: string): Promise<void> {
      const resolved = await requireManageAccess(userId, noteId)
      if (!isValidObjectId(targetUserId)) {
        throw new AppError(404, 'SHARE_USER_NOT_FOUND', 'Không tìm thấy người dùng phù hợp.')
      }
      const ownerId = String((resolved.note as PersistedAccessNote).ownerId)
      if (targetUserId === ownerId) {
        throw new AppError(422, 'NOTE_OWNER_PERMISSION_IMMUTABLE', 'Không thể thu hồi quyền của chủ sở hữu.')
      }
      if (targetUserId === userId && resolved.access.role !== 'owner') {
        throw new AppError(403, 'NOTE_SELF_PERMISSION_IMMUTABLE', 'Bạn không thể tự thu hồi quyền của chính mình.')
      }
      await repository.deleteShare(noteId, targetUserId)
    },
  }
}

export const noteSharesService = createNoteSharesService(noteSharesRepository, notesRepository)
