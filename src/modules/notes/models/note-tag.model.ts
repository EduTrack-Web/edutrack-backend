import { Schema, model, type InferSchemaType } from 'mongoose'

import {
  NOTE_TAG_COLOR_PATTERN,
  NOTE_TAG_DEFAULT_COLOR,
  NOTE_TAG_NAME_MAX_LENGTH,
} from '../config/notes.config.js'

const noteTagSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: NOTE_TAG_NAME_MAX_LENGTH },
    normalizedName: { type: String, required: true, maxlength: NOTE_TAG_NAME_MAX_LENGTH },
    color: { type: String, required: true, default: NOTE_TAG_DEFAULT_COLOR, match: NOTE_TAG_COLOR_PATTERN },
  },
  { timestamps: true, versionKey: false },
)

noteTagSchema.index({ ownerId: 1, normalizedName: 1 }, { unique: true })
noteTagSchema.index({ ownerId: 1, name: 1 })

export type NoteTagDocument = InferSchemaType<typeof noteTagSchema>
export const NoteTagModel = model('NoteTag', noteTagSchema)
