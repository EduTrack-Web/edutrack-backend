import { AppError } from '@/shared/errors/app-error.js'
import type {
  HolidayCalendarType,
  OfficialHolidayEntry,
  OfficialHolidaySource,
  OfficialHolidayYearStatus,
} from '@/modules/calendar/types/calendar.types.js'
import {
  LUNAR_SUPPORTED_MAX_YEAR,
  LUNAR_SUPPORTED_MIN_YEAR,
  parseIsoDateOnly,
} from '@/modules/calendar/validations/lunar-calendar.validation.js'

export interface ValidatedOfficialHolidayYearInput {
  year: number
  status: OfficialHolidayYearStatus
  source: OfficialHolidaySource
  holidays: OfficialHolidayEntry[]
}

const VALID_STATUSES: ReadonlySet<OfficialHolidayYearStatus> = new Set(['draft', 'confirmed', 'archived'])
const VALID_CALENDAR_TYPES: ReadonlySet<HolidayCalendarType> = new Set(['solar', 'lunar', 'compensatory'])
const ENTRY_KEY_PATTERN = /^[a-z0-9_]+$/

const validateEntry = (
  rawEntry: unknown,
  index: number,
  expectedYear: number | null,
  fieldErrors: Record<string, string>,
): OfficialHolidayEntry | null => {
  if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) {
    fieldErrors[`holidays.${index}`] = 'Mục ngày lễ phải là một object.'
    return null
  }

  const record = rawEntry as Record<string, unknown>
  const key = typeof record.key === 'string' ? record.key.trim() : ''
  const solarDate = typeof record.solarDate === 'string' ? record.solarDate.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const calendarType = record.calendarType
  const isDayOff = record.isDayOff

  let valid = true
  if (!key || !ENTRY_KEY_PATTERN.test(key)) {
    fieldErrors[`holidays.${index}.key`] = 'Key ngày lễ chỉ được chứa chữ thường, số và dấu gạch dưới.'
    valid = false
  }

  try {
    const parsed = parseIsoDateOnly(solarDate, 'from')
    if (expectedYear !== null && parsed.year !== expectedYear) {
      fieldErrors[`holidays.${index}.solarDate`] = `Ngày ${solarDate} không thuộc năm ${expectedYear}.`
      valid = false
    }
  } catch {
    fieldErrors[`holidays.${index}.solarDate`] = 'Ngày Dương lịch phải đúng định dạng YYYY-MM-DD và tồn tại.'
    valid = false
  }

  if (!name) {
    fieldErrors[`holidays.${index}.name`] = 'Tên ngày lễ không được để trống.'
    valid = false
  }

  if (typeof calendarType !== 'string' || !VALID_CALENDAR_TYPES.has(calendarType as HolidayCalendarType)) {
    fieldErrors[`holidays.${index}.calendarType`] = 'calendarType phải là solar, lunar hoặc compensatory.'
    valid = false
  }

  if (typeof isDayOff !== 'boolean') {
    fieldErrors[`holidays.${index}.isDayOff`] = 'isDayOff phải là boolean.'
    valid = false
  }

  if (!valid) return null

  const entry: OfficialHolidayEntry = {
    key,
    solarDate,
    name,
    calendarType: calendarType as HolidayCalendarType,
    isDayOff: isDayOff as boolean,
  }

  if (typeof record.replacesRuleKey === 'string' && record.replacesRuleKey.trim()) {
    entry.replacesRuleKey = record.replacesRuleKey.trim()
  }
  if (typeof record.lunarDateLabel === 'string' && record.lunarDateLabel.trim()) {
    entry.lunarDateLabel = record.lunarDateLabel.trim()
  }
  if (typeof record.notes === 'string' && record.notes.trim()) {
    entry.notes = record.notes.trim()
  }

  return entry
}

export const validateOfficialHolidayYearInput = (value: unknown): ValidatedOfficialHolidayYearInput => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(422, 'INVALID_OFFICIAL_HOLIDAY_YEAR', 'Dữ liệu ngày lễ chính thức theo năm không hợp lệ.')
  }

  const record = value as Record<string, unknown>
  const fieldErrors: Record<string, string> = {}

  const rawYear = record.year
  const validYear =
    typeof rawYear === 'number'
    && Number.isSafeInteger(rawYear)
    && rawYear >= LUNAR_SUPPORTED_MIN_YEAR
    && rawYear <= LUNAR_SUPPORTED_MAX_YEAR
  if (!validYear) {
    fieldErrors.year = `Năm phải là số nguyên từ ${LUNAR_SUPPORTED_MIN_YEAR} đến ${LUNAR_SUPPORTED_MAX_YEAR}.`
  }

  const rawStatus = record.status
  const validStatus = typeof rawStatus === 'string' && VALID_STATUSES.has(rawStatus as OfficialHolidayYearStatus)
  if (!validStatus) {
    fieldErrors.status = 'Trạng thái phải là draft, confirmed hoặc archived.'
  }

  let validatedSource: OfficialHolidaySource | null = null
  if (typeof record.source !== 'object' || record.source === null || Array.isArray(record.source)) {
    fieldErrors.source = 'Thông tin nguồn xác minh (source) là bắt buộc.'
  } else {
    const src = record.source as Record<string, unknown>
    const sourceName = typeof src.name === 'string' ? src.name.trim() : ''
    const referenceUrl = typeof src.referenceUrl === 'string' ? src.referenceUrl.trim() : ''
    const verifiedBy = typeof src.verifiedBy === 'string' ? src.verifiedBy.trim() : ''
    const verifiedAt = typeof src.verifiedAt === 'string' ? src.verifiedAt.trim() : ''

    if (!sourceName) {
      fieldErrors['source.name'] = 'Tên nguồn chính thức không được để trống.'
    }
    if (rawStatus === 'confirmed' && !verifiedBy && !referenceUrl) {
      fieldErrors['source.verifiedBy'] = 'Dữ liệu confirmed bắt buộc phải có người xác minh hoặc liên kết nguồn chính thức.'
    }
    if (verifiedAt && Number.isNaN(Date.parse(verifiedAt))) {
      fieldErrors['source.verifiedAt'] = 'source.verifiedAt phải là chuỗi ISO date hợp lệ.'
    }

    validatedSource = {
      name: sourceName,
      ...(referenceUrl ? { referenceUrl } : {}),
      ...(verifiedBy ? { verifiedBy } : {}),
      ...(verifiedAt ? { verifiedAt: new Date(verifiedAt).toISOString() } : {}),
    }
  }

  const validatedHolidays: OfficialHolidayEntry[] = []
  if (!Array.isArray(record.holidays)) {
    fieldErrors.holidays = 'holidays phải là một mảng.'
  } else {
    const seenPairs = new Set<string>()
    record.holidays.forEach((rawEntry, index) => {
      const entry = validateEntry(rawEntry, index, validYear ? (rawYear as number) : null, fieldErrors)
      if (!entry) return
      const pairKey = `${entry.solarDate}:${entry.key}`
      if (seenPairs.has(pairKey)) {
        fieldErrors[`holidays.${index}.key`] = `Trùng lặp (solarDate, key) "${pairKey}" trong cùng một năm.`
        return
      }
      seenPairs.add(pairKey)
      validatedHolidays.push(entry)
    })
  }

  if (Object.keys(fieldErrors).length > 0 || !validatedSource) {
    throw new AppError(
      422,
      'INVALID_OFFICIAL_HOLIDAY_YEAR',
      'Dữ liệu ngày lễ chính thức theo năm không hợp lệ.',
      fieldErrors,
    )
  }

  return {
    year: rawYear as number,
    status: rawStatus as OfficialHolidayYearStatus,
    source: validatedSource,
    holidays: validatedHolidays,
  }
}
