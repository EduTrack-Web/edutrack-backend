import { Schema, model, type InferSchemaType } from 'mongoose'

const chatGroupInvitationSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'ChatGroup', required: true },
    inviteeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], required: true, default: 'pending' },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
)

chatGroupInvitationSchema.index({ groupId: 1, inviteeId: 1 }, { unique: true })
chatGroupInvitationSchema.index({ inviteeId: 1, status: 1, createdAt: -1 })

export type ChatGroupInvitationDocument = InferSchemaType<typeof chatGroupInvitationSchema>
export const ChatGroupInvitationModel = model('ChatGroupInvitation', chatGroupInvitationSchema)
