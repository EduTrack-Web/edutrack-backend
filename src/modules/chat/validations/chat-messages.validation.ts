import { AppError } from '@/shared/errors/app-error.js'
import {
  CHAT_MESSAGE_CLIENT_ID_MAX_LENGTH,
  CHAT_MESSAGE_CLIENT_ID_MIN_LENGTH,
  CHAT_MESSAGE_TEXT_MAX_LENGTH,
} from '@/modules/chat/config/chat.config.js'

export interface CreateChatMessageInput {
  content: string
  clientMessageId: string
}

const clientMessageIdPattern = /^[A-Za-z0-9_-]+$/u

export const validateCreateChatMessage = (rawInput: unknown): CreateChatMessageInput => {
  const input = typeof rawInput === 'object' && rawInput !== null && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown>
    : {}
  const fieldErrors: Record<string, string> = {}

  const content = typeof input.content === 'string' ? input.content.trim() : ''
  const contentLength = Array.from(content).length
  if (!content) {
    fieldErrors.content = 'Vui lòng nhập nội dung tin nhắn.'
  } else if (contentLength > CHAT_MESSAGE_TEXT_MAX_LENGTH) {
    fieldErrors.content = `Nội dung tin nhắn không được vượt quá ${CHAT_MESSAGE_TEXT_MAX_LENGTH.toLocaleString('vi-VN')} ký tự.`
  }

  const clientMessageId = typeof input.clientMessageId === 'string' ? input.clientMessageId.trim() : ''
  if (
    clientMessageId.length < CHAT_MESSAGE_CLIENT_ID_MIN_LENGTH
    || clientMessageId.length > CHAT_MESSAGE_CLIENT_ID_MAX_LENGTH
    || !clientMessageIdPattern.test(clientMessageId)
  ) {
    fieldErrors.clientMessageId = 'Mã gửi tin nhắn không hợp lệ.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu tin nhắn không hợp lệ.', fieldErrors)
  }

  return { content, clientMessageId }
}
