import { Schema, model, type InferSchemaType } from 'mongoose'

const noteShareSchema = new Schema(
  {
    noteId: { type: Schema.Types.ObjectId, ref: 'Note', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, enum: ['view', 'edit'], required: true },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
)

noteShareSchema.index({ noteId: 1, userId: 1 }, { unique: true })
noteShareSchema.index({ userId: 1, updatedAt: -1 })

export type NoteShareDocument = InferSchemaType<typeof noteShareSchema>
export const NoteShareModel = model('NoteShare', noteShareSchema)
