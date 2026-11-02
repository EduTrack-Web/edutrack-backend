import type { NoteBackground } from '../config/notes.config.js'

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

export interface NoteSummary {
  id: string
  title: string
  preview: string
  contentPreview: NoteContentNode
  background: NoteBackground
  version: number
  createdAt: string
  updatedAt: string
}

export interface NoteDetail extends NoteSummary {
  content: NoteContentNode
}

export interface NoteImageUploadResult {
  src: string
  publicId: string
  width: number
  height: number
  format: 'jpg' | 'jpeg' | 'png' | 'webp'
}

