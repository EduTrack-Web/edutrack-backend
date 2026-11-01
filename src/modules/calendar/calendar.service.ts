import { calendarRepository } from './calendar.repository.js'

export const calendarService = {
  getUserEvents: async (userId: string) => {
    // Tầng xử lý nghiệp vụ (Business Logic) của module Calendar
    return calendarRepository.findEventsByUserId(userId)
  },
}

