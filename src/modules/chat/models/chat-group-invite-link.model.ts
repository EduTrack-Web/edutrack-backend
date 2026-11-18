import { Schema, model, type InferSchemaType } from 'mongoose'

const chatGroupInviteLinkSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'ChatGroup', required: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

chatGroupInviteLinkSchema.index({ groupId: 1, revokedAt: 1, expiresAt: -1 })

export type ChatGroupInviteLinkDocument = InferSchemaType<typeof chatGroupInviteLinkSchema>
export const ChatGroupInviteLinkModel = model('ChatGroupInviteLink', chatGroupInviteLinkSchema)
