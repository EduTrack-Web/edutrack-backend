import { AppError } from '../../../shared/errors/app-error.js'
import { env } from '../../../config/env.js'
import {
  NOTE_CONTENT_MAX_BYTES,
  NOTE_CONTENT_MAX_DEPTH,
  NOTE_CONTENT_MAX_NODES,
} from '../config/notes.config.js'
import type { NoteContentMark, NoteContentNode } from '../types/notes.types.js'

const blockTypes = new Set(['paragraph', 'bulletList', 'orderedList', 'taskList', 'image'])
const inlineTypes = new Set(['text', 'hardBreak'])
const allowedMarks = new Set(['bold', 'italic'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

const contentError = (): AppError =>
  new AppError(422, 'INVALID_NOTE_CONTENT', 'Nội dung ghi chú không hợp lệ.', {
    content: 'Nội dung ghi chú không đúng định dạng được hỗ trợ.',
  })

const validateMarks = (value: unknown): readonly NoteContentMark[] => {
  if (!Array.isArray(value)) throw contentError()
  const seen = new Set<string>()
  return value.map((mark) => {
    if (!isRecord(mark) || !hasOnlyKeys(mark, ['type']) || typeof mark.type !== 'string') throw contentError()
    if (!allowedMarks.has(mark.type) || seen.has(mark.type)) throw contentError()
    seen.add(mark.type)
    return { type: mark.type as NoteContentMark['type'] }
  })
}

const validateImageAttrs = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['src', 'alt', 'title', 'publicId', 'width', 'height'])) {
    throw contentError()
  }
  if (typeof value.src !== 'string' || typeof value.publicId !== 'string') throw contentError()
  if (value.alt !== null && value.alt !== undefined && typeof value.alt !== 'string') throw contentError()
  if (value.title !== null && value.title !== undefined && typeof value.title !== 'string') throw contentError()
  for (const dimension of ['width', 'height'] as const) {
    const size = value[dimension]
    if (size !== null && size !== undefined && (!Number.isSafeInteger(size) || Number(size) < 1)) {
      throw contentError()
    }
  }
  return value
}

const validateChildren = (
  value: unknown,
  allowedTypes: ReadonlySet<string>,
  depth: number,
  counter: { count: number },
): readonly NoteContentNode[] => {
  if (!Array.isArray(value)) throw contentError()
  return value.map((child) => validateNode(child, allowedTypes, depth + 1, counter))
}

const validateNode = (
  value: unknown,
  allowedTypes: ReadonlySet<string>,
  depth: number,
  counter: { count: number },
): NoteContentNode => {
  counter.count += 1
  if (counter.count > NOTE_CONTENT_MAX_NODES || depth > NOTE_CONTENT_MAX_DEPTH || !isRecord(value)) throw contentError()
  if (typeof value.type !== 'string' || !allowedTypes.has(value.type)) throw contentError()

  switch (value.type) {
    case 'text': {
      if (!hasOnlyKeys(value, ['type', 'text', 'marks']) || typeof value.text !== 'string') throw contentError()
      return {
        type: 'text',
        text: value.text,
        ...(value.marks === undefined ? {} : { marks: validateMarks(value.marks) }),
      }
    }
    case 'hardBreak':
      if (!hasOnlyKeys(value, ['type'])) throw contentError()
      return { type: 'hardBreak' }
    case 'paragraph':
      if (!hasOnlyKeys(value, ['type', 'content'])) throw contentError()
      return {
        type: 'paragraph',
        ...(value.content === undefined ? {} : { content: validateChildren(value.content, inlineTypes, depth, counter) }),
      }
    case 'image':
      if (!hasOnlyKeys(value, ['type', 'attrs'])) throw contentError()
      return { type: 'image', attrs: validateImageAttrs(value.attrs) }
    case 'bulletList':
      if (!hasOnlyKeys(value, ['type', 'content'])) throw contentError()
      return {
        type: value.type,
        content: validateChildren(value.content, new Set(['listItem']), depth, counter),
      }
    case 'orderedList': {
      if (!hasOnlyKeys(value, ['type', 'attrs', 'content']) || !isRecord(value.attrs)) throw contentError()
      if (!hasOnlyKeys(value.attrs, ['start', 'type'])) throw contentError()
      const start = value.attrs.start
      const listType = value.attrs.type
      if (!Number.isInteger(start) || Number(start) < 1 || listType !== null) throw contentError()
      return {
        type: 'orderedList',
        attrs: { start, type: null },
        content: validateChildren(value.content, new Set(['listItem']), depth, counter),
      }
    }
    case 'listItem':
      if (!hasOnlyKeys(value, ['type', 'content'])) throw contentError()
      return {
        type: 'listItem',
        content: validateChildren(value.content, new Set(['paragraph', 'bulletList', 'orderedList']), depth, counter),
      }
    case 'taskList':
      if (!hasOnlyKeys(value, ['type', 'content'])) throw contentError()
      return { type: 'taskList', content: validateChildren(value.content, new Set(['taskItem']), depth, counter) }
    case 'taskItem': {
      if (!hasOnlyKeys(value, ['type', 'attrs', 'content']) || !isRecord(value.attrs)) throw contentError()
      if (!hasOnlyKeys(value.attrs, ['checked']) || typeof value.attrs.checked !== 'boolean') throw contentError()
      return {
        type: 'taskItem',
        attrs: { checked: value.attrs.checked },
        content: validateChildren(value.content, new Set(['paragraph', 'taskList']), depth, counter),
      }
    }
    default:
      throw contentError()
  }
}

export const validateNoteContent = (value: unknown): NoteContentNode => {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw contentError()
  }
  if (Buffer.byteLength(serialized, 'utf8') > NOTE_CONTENT_MAX_BYTES) throw contentError()
  if (!isRecord(value) || value.type !== 'doc' || !hasOnlyKeys(value, ['type', 'content'])) throw contentError()
  const counter = { count: 1 }
  return {
    type: 'doc',
    content: validateChildren(value.content, blockTypes, 0, counter),
  }
}

export const extractPlainText = (node: NoteContentNode): string => {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const separator = ['paragraph', 'listItem', 'taskItem'].includes(node.type) ? '\n' : ' '
  return (node.content ?? []).map(extractPlainText).join(separator).replace(/\s+/g, ' ').trim()
}

export const validateNoteImageReferences = (node: NoteContentNode, userId: string): void => {
  if (node.type === 'image') {
    const src = node.attrs?.src
    const publicId = node.attrs?.publicId
    if (!env.cloudinaryCloudName || typeof src !== 'string' || typeof publicId !== 'string') throw contentError()
    let imageUrl: URL
    try {
      imageUrl = new URL(src)
    } catch {
      throw contentError()
    }
    const expectedAssetPath = `/edutrack/notes/${userId}/`
    if (
      imageUrl.protocol !== 'https:'
      || imageUrl.hostname !== 'res.cloudinary.com'
      || !imageUrl.pathname.startsWith(`/${env.cloudinaryCloudName}/image/upload/`)
      || !imageUrl.pathname.includes(expectedAssetPath)
      || !publicId.startsWith(`edutrack/notes/${userId}/`)
    ) {
      throw contentError()
    }
  }
  for (const child of node.content ?? []) validateNoteImageReferences(child, userId)
}
