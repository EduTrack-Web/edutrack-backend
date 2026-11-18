import { Schema, model, type InferSchemaType } from 'mongoose'

const userBlockSchema = new Schema(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blockedId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

userBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true })
userBlockSchema.index({ blockedId: 1, blockerId: 1 })

export type UserBlockDocument = InferSchemaType<typeof userBlockSchema>
export const UserBlockModel = model('UserBlock', userBlockSchema)
