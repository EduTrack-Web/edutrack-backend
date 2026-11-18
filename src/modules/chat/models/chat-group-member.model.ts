import { Schema, model, type InferSchemaType } from 'mongoose'

import { CHAT_GROUP_ROLE_VALUES } from '@/modules/chat/config/chat.config.js'

const chatGroupMemberSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'ChatGroup', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: CHAT_GROUP_ROLE_VALUES, required: true, default: 'member' },
    joinedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
)

chatGroupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true })
chatGroupMemberSchema.index({ userId: 1, updatedAt: -1 })

export type ChatGroupMemberDocument = InferSchemaType<typeof chatGroupMemberSchema>
export const ChatGroupMemberModel = model('ChatGroupMember', chatGroupMemberSchema)
