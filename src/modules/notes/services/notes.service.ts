import { notesRepository } from '../repositories/notes.repository.js'

export const notesService = {
  getUserNotes: async (userId: string) => {
    // Tầng xử lý nghiệp vụ (Business Logic) của module Notes
    return notesRepository.findNotesByUserId(userId)
  },
}

