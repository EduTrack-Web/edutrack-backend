import { Schema, model, type InferSchemaType } from 'mongoose'

import { NOTE_BACKGROUND_VALUES, NOTE_DEFAULT_TITLE, NOTE_TITLE_MAX_LENGTH } from '@/modules/notes/config/notes.config.js'

const emptyDocument = () => ({ type: 'doc', content: [{ type: 'paragraph' }] })

const noteSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: NOTE_TITLE_MAX_LENGTH,
      default: NOTE_DEFAULT_TITLE,
    },
    content: { type: Schema.Types.Mixed, required: true, default: emptyDocument },
    plainText: { type: String, default: '' },
    background: { type: String, enum: NOTE_BACKGROUND_VALUES, required: true, default: 'default' },
    version: { type: Number, required: true, min: 1, default: 1 },
    deletedAt: { type: Date, default: null },
    purgeAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
)

noteSchema.index({ ownerId: 1, deletedAt: 1, updatedAt: -1 })
noteSchema.index({ ownerId: 1, deletedAt: 1, purgeAt: 1 })
noteSchema.index({ purgeAt: 1 })
noteSchema.index({ title: 'text', plainText: 'text' })

export type NoteDocument = InferSchemaType<typeof noteSchema>
export const NoteModel = model('Note', noteSchema)
