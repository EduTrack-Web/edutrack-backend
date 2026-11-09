import { Schema, model, type InferSchemaType } from 'mongoose'

const noteTagAssignmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    noteId: { type: Schema.Types.ObjectId, ref: 'Note', required: true },
    tagId: { type: Schema.Types.ObjectId, ref: 'NoteTag', required: true },
  },
  { timestamps: true, versionKey: false },
)

noteTagAssignmentSchema.index({ userId: 1, noteId: 1, tagId: 1 }, { unique: true })
noteTagAssignmentSchema.index({ userId: 1, tagId: 1 })

export type NoteTagAssignmentDocument = InferSchemaType<typeof noteTagAssignmentSchema>
export const NoteTagAssignmentModel = model('NoteTagAssignment', noteTagAssignmentSchema)
