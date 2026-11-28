import { Schema, model, type InferSchemaType } from 'mongoose'

const googleOAuthNonceSchema = new Schema(
  {
    nonce: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
)

googleOAuthNonceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 })

export type GoogleOAuthNonceDocument = InferSchemaType<typeof googleOAuthNonceSchema>
export const GoogleOAuthNonceModel = model('GoogleOAuthNonce', googleOAuthNonceSchema)
