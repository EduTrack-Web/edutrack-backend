import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '../../src/shared/errors/app-error.js'
import {
  extractPlainText,
  validateNoteContent,
} from '../../src/modules/notes/validation/note-content.validation.js'

test('accepts the supported Tiptap nodes and extracts searchable plain text', () => {
  const content = validateNoteContent({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Tiêu đề', marks: [{ type: 'underline' }] }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Kiến thức ', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#052659' } }] },
          { type: 'text', text: 'quan trọng', marks: [{ type: 'italic' }] },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ôn bài' }] }],
          },
        ],
      },
    ],
  })

  assert.equal(extractPlainText(content), 'Tiêu đề Kiến thức quan trọng Ôn bài')
})

test('rejects nodes, marks and attributes outside the allowed editor schema', () => {
  const invalidDocuments = [
    { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }] }] },
    { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, admin: true }, content: [{ type: 'paragraph' }] }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'url(javascript:alert(1))' } }] }] }] },
  ]

  for (const document of invalidDocuments) {
    assert.throws(
      () => validateNoteContent(document),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_NOTE_CONTENT',
    )
  }
})
