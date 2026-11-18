import type { NoteBackground } from '@/modules/notes/config/notes.config.js'

export interface NoteContentMark {
  type: 'bold' | 'italic' | 'underline' | 'textStyle'
  attrs?: Readonly<Record<string, unknown>>
}

export interface NoteContentNode {
  type: string
  attrs?: Readonly<Record<string, unknown>>
  content?: readonly NoteContentNode[]
  marks?: readonly NoteContentMark[]
  text?: string
}

export type NotePermission = 'view' | 'edit'
export type NoteAccessRole = 'owner' | NotePermission

export interface NoteAccess {
  role: NoteAccessRole
  canEdit: boolean
  canManageAccess: boolean
  isSharedWithMe: boolean
}

export interface NoteSummary {
  id: string
  title: string
  preview: string
  contentPreview: NoteContentNode
  background: NoteBackground
  version: number
  createdAt: string
  updatedAt: string
  access: NoteAccess
}

export interface NoteDetail extends NoteSummary {
  content: NoteContentNode
}

export interface TrashedNoteSummary extends NoteSummary {
  deletedAt: string
  purgeAt: string
}

export interface NoteTag {
  id: string
  name: string
  color: string
  createdAt: string
}

export interface NoteShareUser {
  id: string
  fullName: string
  username: string
  avatarUrl?: string
}

export interface NoteCollaborator extends NoteShareUser {
  permission: NotePermission
  isCurrentUser: boolean
}

export interface NoteImageUploadResult {
  src: string
  publicId: string
  width: number
  height: number
  format: 'jpg' | 'jpeg' | 'png' | 'webp'
}

