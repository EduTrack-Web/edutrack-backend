import { Schema, model, type InferSchemaType } from 'mongoose'

const friendshipSchema = new Schema(
  {
    userAId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userBId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending', required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
)

friendshipSchema.index({ userAId: 1, userBId: 1 }, { unique: true })
friendshipSchema.index({ userAId: 1, status: 1, updatedAt: -1 })
friendshipSchema.index({ userBId: 1, status: 1, updatedAt: -1 })

export type FriendshipDocument = InferSchemaType<typeof friendshipSchema>
export const FriendshipModel = model('Friendship', friendshipSchema)
