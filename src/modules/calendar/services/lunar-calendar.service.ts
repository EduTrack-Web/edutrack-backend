import { AppError } from '@/shared/errors/app-error.js'
import { calendarRepository } from '@/modules/calendar/repositories/calendar.repository.js'
import type { CalendarPreferences, VietnameseLunarDate } from '@/modules/calendar/types/calendar.types.js'
import { vietnameseLunarAdapter, type LunarDateProvider } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'
import {
  dateOnlyFromOrdinal,
  validateCalendarPreferencesInput,
  validateLunarDateRange,
} from '@/modules/calendar/validations/lunar-calendar.validation.js'

const readShowLunarCalendar = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || !('preferences' in value)) return false
  const preferences = (value as { preferences?: unknown }).preferences
  if (typeof preferences !== 'object' || preferences === null || !('calendar' in preferences)) return false
  const calendar = (preferences as { calendar?: unknown }).calendar
  if (typeof calendar !== 'object' || calendar === null || !('showLunarCalendar' in calendar)) return false
  return (calendar as { showLunarCalendar?: unknown }).showLunarCalendar === true
}

export class LunarCalendarService {
  public constructor(private readonly provider: LunarDateProvider = vietnameseLunarAdapter) {}

  public async getPreferences(userId: string): Promise<CalendarPreferences> {
    const user = await calendarRepository.findCalendarPreferences(userId)
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    return { showLunarCalendar: readShowLunarCalendar(user) }
  }

  public async updatePreferences(userId: string, input: unknown): Promise<CalendarPreferences> {
    const showLunarCalendar = validateCalendarPreferencesInput(input)
    const user = await calendarRepository.updateCalendarPreferences(userId, showLunarCalendar)
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    return { showLunarCalendar: readShowLunarCalendar(user) }
  }

  public getDates(fromValue: unknown, toValue: unknown): VietnameseLunarDate[] {
    const { startOrdinal, endOrdinal } = validateLunarDateRange(fromValue, toValue)
    const dates: VietnameseLunarDate[] = []

    for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
      dates.push(this.provider.convert(dateOnlyFromOrdinal(ordinal)))
    }

    return dates
  }
}

export const lunarCalendarService = new LunarCalendarService()
