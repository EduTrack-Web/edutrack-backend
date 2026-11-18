import { Schema, model, type InferSchemaType } from 'mongoose'

import {
  CHAT_GROUP_DESCRIPTION_MAX_LENGTH,
  CHAT_GROUP_HISTORY_VALUES,
  CHAT_GROUP_NAME_MAX_LENGTH,
  CHAT_GROUP_NAME_MIN_LENGTH,
} from '@/modules/chat/config/chat.config.js'

const chatGroupSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: CHAT_GROUP_NAME_MIN_LENGTH,
      maxlength: CHAT_GROUP_NAME_MAX_LENGTH,
    },
    description: { type: String, trim: true, maxlength: CHAT_GROUP_DESCRIPTION_MAX_LENGTH, default: '' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inviteLinksEnabled: { type: Boolean, required: true, default: true },
    historyVisibility: { type: String, enum: CHAT_GROUP_HISTORY_VALUES, required: true, default: 'from_join' },
    status: { type: String, enum: ['active'], required: true, default: 'active' },
  },
  { timestamps: true },
)

chatGroupSchema.index({ ownerId: 1, updatedAt: -1 })

export type ChatGroupDocument = InferSchemaType<typeof chatGroupSchema>
export const ChatGroupModel = model('ChatGroup', chatGroupSchema)
