import { Schema, model, type InferSchemaType } from 'mongoose'

import {
  CHAT_MESSAGE_CLIENT_ID_MAX_LENGTH,
  CHAT_MESSAGE_CLIENT_ID_MIN_LENGTH,
  CHAT_MESSAGE_TEXT_MAX_LENGTH,
} from '@/modules/chat/config/chat.config.js'

const directChatMessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Friendship', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientMessageId: {
      type: String,
      required: true,
      minlength: CHAT_MESSAGE_CLIENT_ID_MIN_LENGTH,
      maxlength: CHAT_MESSAGE_CLIENT_ID_MAX_LENGTH,
    },
    content: {
      type: String,
      required: true,
      validate: {
        validator: (value: string) => Array.from(value).length <= CHAT_MESSAGE_TEXT_MAX_LENGTH,
        message: `Nội dung tin nhắn không được vượt quá ${CHAT_MESSAGE_TEXT_MAX_LENGTH.toLocaleString('vi-VN')} ký tự.`,
      },
    },
  },
  { timestamps: true, versionKey: false },
)

directChatMessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 })
directChatMessageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true },
)

export type DirectChatMessageDocument = InferSchemaType<typeof directChatMessageSchema>
export const DirectChatMessageModel = model('DirectChatMessage', directChatMessageSchema)
