export const CHAT_GROUP_NAME_MIN_LENGTH = 3
export const CHAT_GROUP_NAME_MAX_LENGTH = 100
export const CHAT_GROUP_DESCRIPTION_MAX_LENGTH = 500
export const CHAT_GROUP_MIN_SELECTED_USERS = 2
export const CHAT_GROUP_INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000

export const CHAT_GROUP_HISTORY_VALUES = ['from_join', 'all'] as const
export type ChatGroupHistoryVisibility = (typeof CHAT_GROUP_HISTORY_VALUES)[number]

export const CHAT_GROUP_ROLE_VALUES = ['owner', 'manager', 'member'] as const
export type ChatGroupRole = (typeof CHAT_GROUP_ROLE_VALUES)[number]

export const CHAT_GROUP_PERMISSIONS: Readonly<Record<ChatGroupRole, {
  canManageInvites: boolean
  canManageJoinLinks: boolean
}>> = {
  owner: { canManageInvites: true, canManageJoinLinks: true },
  manager: { canManageInvites: true, canManageJoinLinks: true },
  member: { canManageInvites: false, canManageJoinLinks: false },
}
