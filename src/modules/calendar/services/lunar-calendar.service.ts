import { AppError } from '@/shared/errors/app-error.js'
import { calendarRepository } from '@/modules/calendar/repositories/calendar.repository.js'
import type { CalendarPreferences, VietnameseLunarDate } from '@/modules/calendar/types/calendar.types.js'
import { vietnameseLunarAdapter, type LunarDateProvider } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'
import {
  dateOnlyFromOrdinal,
  validateCalendarPreferencesInput,
  validateLunarDateRange,
} from '@/modules/calendar/validations/lunar-calendar.validation.js'

const readCalendarPreferences = (value: unknown): CalendarPreferences => {
  const defaults: CalendarPreferences = {
    showLunarCalendar: false,
    showVietnameseHolidays: true,
    showPublicHolidays: true,
    showObservanceHolidays: true,
  }
  if (typeof value !== 'object' || value === null || !('preferences' in value)) return defaults
  const preferences = (value as { preferences?: unknown }).preferences
  if (typeof preferences !== 'object' || preferences === null || !('calendar' in preferences)) return defaults
  const calendar = (preferences as { calendar?: unknown }).calendar
  if (typeof calendar !== 'object' || calendar === null) return defaults

  const record = calendar as Record<string, unknown>
  return {
    showLunarCalendar: record.showLunarCalendar === true,
    showVietnameseHolidays: record.showVietnameseHolidays !== false,
    showPublicHolidays: record.showPublicHolidays !== false,
    showObservanceHolidays: record.showObservanceHolidays !== false,
  }
}

export interface CalendarPreferencesRepository {
  findCalendarPreferences: (userId: string) => Promise<unknown>
  updateCalendarPreferences: (
    userId: string,
    preferences: Partial<CalendarPreferences>,
  ) => Promise<unknown>
}

export class LunarCalendarService {
  public constructor(
    private readonly provider: LunarDateProvider = vietnameseLunarAdapter,
    private readonly repository: CalendarPreferencesRepository = calendarRepository,
  ) {}

  public async getPreferences(userId: string): Promise<CalendarPreferences> {
    const user = await this.repository.findCalendarPreferences(userId)
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    return readCalendarPreferences(user)
  }

  public async updatePreferences(userId: string, input: unknown): Promise<CalendarPreferences> {
    const validated = validateCalendarPreferencesInput(input)
    const user = await this.repository.updateCalendarPreferences(userId, validated)
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.')
    return readCalendarPreferences(user)
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
