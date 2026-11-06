export interface MessagePayload {
  channelId: string
  content: string
}

export interface ChatChannelItem {
  id: string
  name: string
  description?: string
}

export interface ChatUserSummary {
  id: string
  fullName: string
  username: string
  avatarUrl?: string
}

export type FriendshipSearchRelation = 'none' | 'friend' | 'incoming' | 'outgoing'

export interface FriendSearchResult extends ChatUserSummary {
  relation: FriendshipSearchRelation
  exactMatch: boolean
}

export interface FriendRequestItem {
  id: string
  direction: 'incoming' | 'outgoing'
  user: ChatUserSummary
  createdAt: string
}

export interface BlockedUserItem extends ChatUserSummary {
  blockedAt: string
}

