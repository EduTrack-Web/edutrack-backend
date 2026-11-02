import { chatRepository } from '../repositories/chat.repository.js'

export const chatService = {
  getUserChannels: async (userId: string) => {
    // Tầng xử lý nghiệp vụ (Business Logic) của module Chat
    return chatRepository.findChannelsByUserId(userId)
  },
}

