import { isValidObjectId } from 'mongoose'

import { AppError } from '@/shared/errors/app-error.js'
import {
  CHAT_GROUP_DESCRIPTION_MAX_LENGTH,
  CHAT_GROUP_HISTORY_VALUES,
  CHAT_GROUP_MIN_SELECTED_USERS,
  CHAT_GROUP_NAME_MAX_LENGTH,
  CHAT_GROUP_NAME_MIN_LENGTH,
  type ChatGroupHistoryVisibility,
} from '@/modules/chat/config/chat.config.js'

export interface CreateChatGroupInput {
  name: string
  description: string
  participantIds: string[]
  historyVisibility: ChatGroupHistoryVisibility
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const validateCreateChatGroup = (input: unknown): CreateChatGroupInput => {
  if (!isRecord(input)) throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  const allowedKeys = ['name', 'description', 'participantIds', 'historyVisibility']
  if (!Object.keys(input).every((key) => allowedKeys.includes(key))) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.')
  }

  const fieldErrors: Record<string, string> = {}
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/gu, ' ') : ''
  const description = typeof input.description === 'string'
    ? input.description.trim().replace(/\s+/gu, ' ')
    : input.description === undefined ? '' : ''
  const participantIds = Array.isArray(input.participantIds)
    ? [...new Set(input.participantIds.filter((value): value is string => typeof value === 'string'))]
    : []
  const historyVisibility = input.historyVisibility === undefined
    ? 'from_join'
    : input.historyVisibility

  if (name.length < CHAT_GROUP_NAME_MIN_LENGTH || name.length > CHAT_GROUP_NAME_MAX_LENGTH) {
    fieldErrors.name = `Tên nhóm phải có từ ${CHAT_GROUP_NAME_MIN_LENGTH} đến ${CHAT_GROUP_NAME_MAX_LENGTH} ký tự.`
  }
  if (typeof input.description !== 'string' && input.description !== undefined) {
    fieldErrors.description = 'Mô tả nhóm không hợp lệ.'
  } else if (description.length > CHAT_GROUP_DESCRIPTION_MAX_LENGTH) {
    fieldErrors.description = `Mô tả không được vượt quá ${CHAT_GROUP_DESCRIPTION_MAX_LENGTH} ký tự.`
  }
  if (!Array.isArray(input.participantIds)
    || participantIds.length < CHAT_GROUP_MIN_SELECTED_USERS
    || !participantIds.every((userId) => isValidObjectId(userId))) {
    fieldErrors.participantIds = `Vui lòng chọn ít nhất ${CHAT_GROUP_MIN_SELECTED_USERS} người khác.`
  }
  if (!CHAT_GROUP_HISTORY_VALUES.includes(historyVisibility as ChatGroupHistoryVisibility)) {
    fieldErrors.historyVisibility = 'Quyền xem lịch sử nhóm không hợp lệ.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', fieldErrors)
  }

  return {
    name,
    description,
    participantIds,
    historyVisibility: historyVisibility as ChatGroupHistoryVisibility,
  }
}
