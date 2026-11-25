import { AppError } from '@/shared/errors/app-error.js'
import type { CalendarPreferences, DateOnlyParts } from '@/modules/calendar/types/calendar.types.js'

export const MAX_LUNAR_DATE_RANGE_DAYS = 400
export const LUNAR_SUPPORTED_MIN_YEAR = 1900
export const LUNAR_SUPPORTED_MAX_YEAR = 2199
const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const isLeapYear = (year: number): boolean =>
  year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

export const parseIsoDateOnly = (value: unknown, fieldName: 'from' | 'to'): DateOnlyParts => {
  if (typeof value !== 'string') {
    throw new AppError(422, 'INVALID_LUNAR_DATE_RANGE', 'Khoảng ngày không hợp lệ.', {
      [fieldName]: `Trường ${fieldName} phải có định dạng YYYY-MM-DD.`,
    })
  }

  const match = ISO_DATE_ONLY_PATTERN.exec(value)
  if (!match) {
    throw new AppError(422, 'INVALID_LUNAR_DATE_RANGE', 'Khoảng ngày không hợp lệ.', {
      [fieldName]: `Trường ${fieldName} phải có định dạng YYYY-MM-DD.`,
    })
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (
    !Number.isSafeInteger(year)
    || year < 1
    || !Number.isInteger(month)
    || month < 1
    || month > 12
    || !Number.isInteger(day)
    || day < 1
    || day > daysInMonth(year, month)
  ) {
    throw new AppError(422, 'INVALID_LUNAR_DATE_RANGE', 'Khoảng ngày không hợp lệ.', {
      [fieldName]: `Ngày ${fieldName} không tồn tại.`,
    })
  }

  return { year, month, day }
}

export const dateOnlyToOrdinal = ({ year, month, day }: DateOnlyParts): number => {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return Math.floor(date.getTime() / 86_400_000)
}

export const dateOnlyFromOrdinal = (ordinal: number): DateOnlyParts => {
  const date = new Date(ordinal * 86_400_000)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

export const formatIsoDateOnly = ({ year, month, day }: DateOnlyParts): string =>
  [year.toString().padStart(4, '0'), month.toString().padStart(2, '0'), day.toString().padStart(2, '0')].join('-')

export const validateDateRangeWindow = (
  fromValue: unknown,
  toValue: unknown,
): { from: DateOnlyParts; to: DateOnlyParts; startOrdinal: number; endOrdinal: number } => {
  const from = parseIsoDateOnly(fromValue, 'from')
  const to = parseIsoDateOnly(toValue, 'to')
  const startOrdinal = dateOnlyToOrdinal(from)
  const endOrdinal = dateOnlyToOrdinal(to)

  if (endOrdinal < startOrdinal) {
    throw new AppError(422, 'INVALID_LUNAR_DATE_RANGE', 'Khoảng ngày không hợp lệ.', {
      to: 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.',
    })
  }

  if (endOrdinal - startOrdinal + 1 > MAX_LUNAR_DATE_RANGE_DAYS) {
    throw new AppError(
      422,
      'LUNAR_DATE_RANGE_TOO_LARGE',
      `Khoảng ngày không được vượt quá ${MAX_LUNAR_DATE_RANGE_DAYS} ngày.`,
      { to: `Chỉ được yêu cầu tối đa ${MAX_LUNAR_DATE_RANGE_DAYS} ngày.` },
    )
  }

  return { from, to, startOrdinal, endOrdinal }
}

export const validateLunarDateRange = (
  fromValue: unknown,
  toValue: unknown,
): { from: DateOnlyParts; to: DateOnlyParts; startOrdinal: number; endOrdinal: number } => {
  const range = validateDateRangeWindow(fromValue, toValue)

  if (range.from.year < LUNAR_SUPPORTED_MIN_YEAR || range.to.year > LUNAR_SUPPORTED_MAX_YEAR) {
    throw new AppError(
      422,
      'LUNAR_DATE_OUT_OF_RANGE',
      'Thời gian lịch quá xa so với hiện tại nên chưa thể hiển thị lịch Âm.',
      { from: `Chỉ hỗ trợ lịch Âm từ năm ${LUNAR_SUPPORTED_MIN_YEAR} đến năm ${LUNAR_SUPPORTED_MAX_YEAR}.` },
    )
  }

  return range
}

const ALLOWED_CALENDAR_PREFERENCE_KEYS: ReadonlySet<keyof CalendarPreferences> = new Set([
  'showLunarCalendar',
  'showVietnameseHolidays',
  'showPublicHolidays',
  'showObservanceHolidays',
])

export const validateCalendarPreferencesInput = (value: unknown): Partial<CalendarPreferences> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(422, 'INVALID_CALENDAR_PREFERENCES', 'Cài đặt lịch không hợp lệ.')
  }

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) {
    throw new AppError(422, 'INVALID_CALENDAR_PREFERENCES', 'Cần cung cấp ít nhất một tùy chọn cài đặt lịch.')
  }

  const sanitized: Partial<CalendarPreferences> = {}
  for (const [key, rawVal] of entries) {
    if (!ALLOWED_CALENDAR_PREFERENCE_KEYS.has(key as keyof CalendarPreferences) || typeof rawVal !== 'boolean') {
      throw new AppError(422, 'INVALID_CALENDAR_PREFERENCES', 'Cài đặt lịch không hợp lệ.', {
        [key]: 'Giá trị tùy chọn phải là true hoặc false.',
      })
    }
    sanitized[key as keyof CalendarPreferences] = rawVal
  }

  return sanitized
}
