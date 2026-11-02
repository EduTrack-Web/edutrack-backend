export interface NoteContentMark {
  type: 'bold' | 'italic'
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

