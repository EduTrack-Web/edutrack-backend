import type { RequestHandler } from 'express'

import type { AuthenticatedRequestLocals } from '../../../shared/middleware/authenticate.js'
import { noteImageService } from '../services/note-image.service.js'
import { noteTagsService } from '../services/note-tags.service.js'
import { notesService } from '../services/notes.service.js'

const userIdFrom = (locals: Record<string, unknown>): string =>
  (locals.auth as AuthenticatedRequestLocals).userId

const noteIdFrom = (value: string | string[] | undefined): string =>
  typeof value === 'string' ? value : ''

const tagIdsFrom = (value: unknown): string[] => {
  if (value === undefined || value === '') return []
  if (typeof value !== 'string') return ['']
  return value.split(',').map((tagId) => tagId.trim()).filter(Boolean)
}

export const getNotes: RequestHandler = async (request, response) => {
  const userId = userIdFrom(response.locals)
  const tagFilter = await noteTagsService.resolveTagFilter(userId, tagIdsFrom(request.query.tagIds))
  const notes = await notesService.getUserNotes(userId, request.query.q, tagFilter.noteIds)
  const tagsByNoteId = await noteTagsService.getTagsForNotes(userId, notes.map((note) => note.id))
  response.json({
    success: true,
    data: {
      notes: notes.map((note) => ({ ...note, tags: tagsByNoteId[note.id] ?? [] })),
      invalidTagIds: tagFilter.invalidTagIds,
    },
  })
}

export const getTrashedNotes: RequestHandler = async (_request, response) => {
  const notes = await notesService.getTrashedNotes(userIdFrom(response.locals))
  response.json({ success: true, data: { notes } })
}

export const createNote: RequestHandler = async (_request, response) => {
  const note = await notesService.createNote(userIdFrom(response.locals))
  response.status(201).json({ success: true, data: { note }, message: 'Đã tạo ghi chú.' })
}

export const duplicateNote: RequestHandler = async (request, response) => {
  const note = await notesService.duplicateNote(
    userIdFrom(response.locals),
    noteIdFrom(request.params.noteId),
    request.body,
  )
  response.status(201).json({ success: true, data: { note }, message: 'Đã nhân bản ghi chú.' })
}

export const getUserTags: RequestHandler = async (_request, response) => {
  const tags = await noteTagsService.getUserTags(userIdFrom(response.locals))
  response.json({ success: true, data: { tags } })
}

export const createTag: RequestHandler = async (request, response) => {
  const tag = await noteTagsService.createTag(userIdFrom(response.locals), request.body)
  response.status(201).json({ success: true, data: { tag }, message: 'Đã tạo thẻ.' })
}

export const updateTag: RequestHandler = async (request, response) => {
  const tag = await noteTagsService.updateTag(
    userIdFrom(response.locals),
    noteIdFrom(request.params.tagId),
    request.body,
  )
  response.json({ success: true, data: { tag }, message: 'Đã cập nhật thẻ.' })
}

export const deleteTag: RequestHandler = async (request, response) => {
  await noteTagsService.deleteTag(userIdFrom(response.locals), noteIdFrom(request.params.tagId))
  response.json({ success: true, data: {}, message: 'Đã xóa thẻ.' })
}

export const getNoteTags: RequestHandler = async (request, response) => {
  const tags = await noteTagsService.getNoteTags(userIdFrom(response.locals), noteIdFrom(request.params.noteId))
  response.json({ success: true, data: { tags } })
}

export const setNoteTags: RequestHandler = async (request, response) => {
  const tags = await noteTagsService.setNoteTags(
    userIdFrom(response.locals),
    noteIdFrom(request.params.noteId),
    request.body,
  )
  response.json({ success: true, data: { tags }, message: 'Gắn thẻ thành công.' })
}

export const removeNoteTag: RequestHandler = async (request, response) => {
  await noteTagsService.removeNoteTag(
    userIdFrom(response.locals),
    noteIdFrom(request.params.noteId),
    noteIdFrom(request.params.tagId),
  )
  response.json({ success: true, data: {}, message: 'Đã bỏ thẻ khỏi ghi chú.' })
}

export const getNote: RequestHandler = async (request, response) => {
  const note = await notesService.getNote(userIdFrom(response.locals), noteIdFrom(request.params.noteId))
  response.json({ success: true, data: { note } })
}

export const updateNote: RequestHandler = async (request, response) => {
  const note = await notesService.updateNote(userIdFrom(response.locals), noteIdFrom(request.params.noteId), request.body)
  response.json({ success: true, data: { note }, message: 'Đã lưu ghi chú.' })
}

export const moveNoteToTrash: RequestHandler = async (request, response) => {
  const note = await notesService.moveNoteToTrash(userIdFrom(response.locals), noteIdFrom(request.params.noteId))
  response.json({ success: true, data: { note }, message: 'Đã chuyển ghi chú vào thùng rác.' })
}

export const restoreNote: RequestHandler = async (request, response) => {
  const note = await notesService.restoreNote(userIdFrom(response.locals), noteIdFrom(request.params.noteId))
  response.json({ success: true, data: { note }, message: 'Đã khôi phục ghi chú.' })
}

export const deleteNotePermanently: RequestHandler = async (request, response) => {
  await notesService.deleteNotePermanently(userIdFrom(response.locals), noteIdFrom(request.params.noteId))
  response.json({ success: true, data: {}, message: 'Đã xóa vĩnh viễn ghi chú.' })
}

export const uploadImage: RequestHandler = async (request, response) => {
  const image = await noteImageService.upload(request.file, userIdFrom(response.locals))
  response.status(201).json({ success: true, data: { image }, message: 'Đã tải ảnh lên.' })
}

