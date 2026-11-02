import type { ChatChannelItem } from '../types/chat.types.js'

export const chatRepository = {
  findChannelsByUserId: async (_userId: string): Promise<ChatChannelItem[]> => {
    // Tầng truy cập dữ liệu (Data Access Layer) của module Chat
    return [
      { id: 'general', name: 'Thảo luận chung', description: 'Kênh trao đổi học tập chung toàn trường' },
      { id: 'assignments', name: 'Đồ án & Bài tập lớn', description: 'Kênh trao đổi tiến độ bài tập và đồ án' },
    ]
  },
}

