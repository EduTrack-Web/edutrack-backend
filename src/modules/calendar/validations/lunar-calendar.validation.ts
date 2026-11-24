import { AppError } from '@/shared/errors/app-error.js'
import type { DateOnlyParts } from '@/modules/calendar/types/calendar.types.js'

export const MAX_LUNAR_DATE_RANGE_DAYS = 400
// Khoảng năm đã được kiểm thử với dữ liệu đối chiếu. Frontend giữ cùng giá trị
// trong lunarCalendar.ts; khi đổi phải cập nhật cả hai phía.
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

export const validateLunarDateRange = (
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

  if (from.year < LUNAR_SUPPORTED_MIN_YEAR || to.year > LUNAR_SUPPORTED_MAX_YEAR) {
    throw new AppError(
      422,
      'LUNAR_DATE_OUT_OF_RANGE',
      'Thời gian lịch quá xa so với hiện tại nên chưa thể hiển thị lịch Âm.',
      { from: `Chỉ hỗ trợ lịch Âm từ năm ${LUNAR_SUPPORTED_MIN_YEAR} đến năm ${LUNAR_SUPPORTED_MAX_YEAR}.` },
    )
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

export const validateCalendarPreferencesInput = (value: unknown): boolean => {
  const keys = typeof value === 'object' && value !== null ? Object.keys(value) : []
  if (
    typeof value !== 'object'
    || value === null
    || keys.length !== 1
    || keys[0] !== 'showLunarCalendar'
    || !('showLunarCalendar' in value)
    || typeof (value as Record<string, unknown>).showLunarCalendar !== 'boolean'
  ) {
    throw new AppError(422, 'INVALID_CALENDAR_PREFERENCES', 'Cài đặt lịch không hợp lệ.', {
      showLunarCalendar: 'Giá trị hiển thị lịch Âm phải là true hoặc false.',
    })
  }

  return (value as { showLunarCalendar: boolean }).showLunarCalendar
}
