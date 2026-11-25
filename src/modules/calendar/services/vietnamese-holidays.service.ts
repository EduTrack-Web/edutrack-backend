import type {
  DateOnlyParts,
  HolidayCalendarType,
  HolidayCategory,
  VietnameseHolidayItem,
} from '@/modules/calendar/types/calendar.types.js'
import { vietnameseLunarAdapter, type LunarDateProvider } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'
import {
  dateOnlyFromOrdinal,
  dateOnlyToOrdinal,
  formatIsoDateOnly,
  LUNAR_SUPPORTED_MAX_YEAR,
  LUNAR_SUPPORTED_MIN_YEAR,
  validateDateRangeWindow,
} from '@/modules/calendar/validations/lunar-calendar.validation.js'

interface FixedHolidayRule {
  key: string
  month: number
  day: number
  name: string
  category: HolidayCategory
}

interface OfficialHolidayOverride {
  key: string
  solarDate: string
  name: string
  calendarType: HolidayCalendarType
  lunarDateLabel?: string
}

export interface RemoteHolidayEntry {
  solarDate: string
  name: string
  calendarType: HolidayCalendarType
  isDayOff: boolean
}

export type RemoteHolidayProvider = (year: number) => Promise<readonly RemoteHolidayEntry[] | null>

interface RemoteCacheEntry {
  expiresAt: number
  items: readonly RemoteHolidayEntry[] | null
}

const REMOTE_CACHE_HIT_TTL_MS = 24 * 60 * 60 * 1000
const REMOTE_CACHE_MISS_TTL_MS = 60 * 60 * 1000
const REMOTE_FETCH_TIMEOUT_MS = 2500
const REMOTE_MIN_YEAR = 2004

const FIXED_SOLAR_PUBLIC_HOLIDAYS: readonly FixedHolidayRule[] = [
  { key: 'new_year', month: 1, day: 1, name: 'Tết Dương lịch', category: 'public_holiday' },
  { key: 'reunification', month: 4, day: 30, name: 'Ngày Chiến thắng', category: 'public_holiday' },
  { key: 'labor_day', month: 5, day: 1, name: 'Ngày Quốc tế Lao động', category: 'public_holiday' },
  { key: 'national_day', month: 9, day: 2, name: 'Ngày Quốc khánh', category: 'public_holiday' },
]

const FIXED_SOLAR_OBSERVANCES: readonly FixedHolidayRule[] = [
  { key: 'party_founding', month: 2, day: 3, name: 'Ngày thành lập Đảng CSVN', category: 'observance' },
  { key: 'valentine', month: 2, day: 14, name: 'Lễ Tình nhân', category: 'observance' },
  { key: 'doctors_day', month: 2, day: 27, name: 'Ngày Thầy thuốc Việt Nam', category: 'observance' },
  { key: 'womens_day', month: 3, day: 8, name: 'Ngày Quốc tế Phụ nữ', category: 'observance' },
  { key: 'youth_union', month: 3, day: 26, name: 'Ngày thành lập Đoàn TNCS HCM', category: 'observance' },
  { key: 'childrens_day', month: 6, day: 1, name: 'Ngày Quốc tế Thiếu nhi', category: 'observance' },
  { key: 'family_day', month: 6, day: 28, name: 'Ngày Gia đình Việt Nam', category: 'observance' },
  { key: 'august_revolution', month: 8, day: 19, name: 'Ngày Cách mạng tháng Tám', category: 'observance' },
  { key: 'vn_womens_day', month: 10, day: 20, name: 'Ngày Phụ nữ Việt Nam', category: 'observance' },
  { key: 'teachers_day', month: 11, day: 20, name: 'Ngày Nhà giáo Việt Nam', category: 'observance' },
  { key: 'army_day', month: 12, day: 22, name: 'Ngày thành lập QĐND Việt Nam', category: 'observance' },
  { key: 'christmas', month: 12, day: 25, name: 'Lễ Giáng sinh', category: 'observance' },
]

const FIXED_LUNAR_OBSERVANCES: readonly FixedHolidayRule[] = [
  { key: 'lantern_festival', month: 1, day: 15, name: 'Rằm tháng Giêng', category: 'observance' },
  { key: 'cold_food', month: 3, day: 3, name: 'Tết Hàn Thực', category: 'observance' },
  { key: 'buddha_birthday', month: 4, day: 15, name: 'Lễ Phật Đản', category: 'observance' },
  { key: 'doan_ngo', month: 5, day: 5, name: 'Tết Đoan Ngọ', category: 'observance' },
  { key: 'vu_lan', month: 7, day: 15, name: 'Lễ Vu Lan', category: 'observance' },
  { key: 'mid_autumn', month: 8, day: 15, name: 'Tết Trung thu', category: 'observance' },
  { key: 'kitchen_gods', month: 12, day: 23, name: 'Ông Công Ông Táo', category: 'observance' },
]

// Lịch nghỉ lễ chính thức hằng năm theo thông báo của Chính phủ (2024–2027).
const OFFICIAL_PUBLIC_HOLIDAY_OVERRIDES: Readonly<Record<number, readonly OfficialHolidayOverride[]>> = {
  2024: [
    { key: 'tet_eve', solarDate: '2024-02-08', name: 'Tết Nguyên Đán (29 Tết)', calendarType: 'lunar', lunarDateLabel: '29/12 Âm lịch' },
    { key: 'tet_30', solarDate: '2024-02-09', name: 'Tết Nguyên Đán (30 Tết)', calendarType: 'lunar', lunarDateLabel: '30/12 Âm lịch' },
    { key: 'tet_1', solarDate: '2024-02-10', name: 'Mùng 1 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '1/1 Âm lịch' },
    { key: 'tet_2', solarDate: '2024-02-11', name: 'Mùng 2 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '2/1 Âm lịch' },
    { key: 'tet_3', solarDate: '2024-02-12', name: 'Mùng 3 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '3/1 Âm lịch' },
    { key: 'tet_comp_1', solarDate: '2024-02-13', name: 'Tết Nguyên Đán (Nghỉ bù)', calendarType: 'compensatory', lunarDateLabel: '4/1 Âm lịch' },
    { key: 'tet_comp_2', solarDate: '2024-02-14', name: 'Tết Nguyên Đán (Nghỉ bù)', calendarType: 'compensatory', lunarDateLabel: '5/1 Âm lịch' },
    { key: 'reunification_swap', solarDate: '2024-04-29', name: 'Dịp 30/4 - 1/5 (Ngày hoán đổi)', calendarType: 'compensatory' },
    { key: 'national_day_adj', solarDate: '2024-09-03', name: 'Ngày Quốc khánh (Nghỉ liền kề)', calendarType: 'solar' },
  ],
  2025: [
    { key: 'tet_28', solarDate: '2025-01-27', name: 'Tết Nguyên Đán (28 Tết)', calendarType: 'lunar', lunarDateLabel: '28/12 Âm lịch' },
    { key: 'tet_29', solarDate: '2025-01-28', name: 'Tết Nguyên Đán (29 Tết)', calendarType: 'lunar', lunarDateLabel: '29/12 Âm lịch' },
    { key: 'tet_1', solarDate: '2025-01-29', name: 'Mùng 1 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '1/1 Âm lịch' },
    { key: 'tet_2', solarDate: '2025-01-30', name: 'Mùng 2 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '2/1 Âm lịch' },
    { key: 'tet_3', solarDate: '2025-01-31', name: 'Mùng 3 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '3/1 Âm lịch' },
    { key: 'labor_swap', solarDate: '2025-05-02', name: 'Dịp 30/4 - 1/5 (Ngày hoán đổi)', calendarType: 'compensatory' },
    { key: 'national_day_adj', solarDate: '2025-09-01', name: 'Ngày Quốc khánh (Nghỉ liền kề)', calendarType: 'solar' },
  ],
  2026: [
    { key: 'new_year_swap', solarDate: '2026-01-02', name: 'Tết Dương lịch (Ngày hoán đổi)', calendarType: 'compensatory' },
    { key: 'tet_29', solarDate: '2026-02-16', name: 'Tết Nguyên Đán (29 Tết)', calendarType: 'lunar', lunarDateLabel: '29/12 Âm lịch' },
    { key: 'tet_1', solarDate: '2026-02-17', name: 'Mùng 1 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '1/1 Âm lịch' },
    { key: 'tet_2', solarDate: '2026-02-18', name: 'Mùng 2 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '2/1 Âm lịch' },
    { key: 'tet_3', solarDate: '2026-02-19', name: 'Mùng 3 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '3/1 Âm lịch' },
    { key: 'tet_4', solarDate: '2026-02-20', name: 'Tết Nguyên Đán (Mùng 4)', calendarType: 'lunar', lunarDateLabel: '4/1 Âm lịch' },
    { key: 'hung_kings_comp', solarDate: '2026-04-27', name: 'Giỗ Tổ Hùng Vương (Nghỉ bù)', calendarType: 'compensatory' },
    { key: 'national_day_swap', solarDate: '2026-08-31', name: 'Ngày Quốc khánh (Ngày hoán đổi)', calendarType: 'compensatory' },
    { key: 'national_day_adj', solarDate: '2026-09-01', name: 'Ngày Quốc khánh (Nghỉ liền kề)', calendarType: 'solar' },
  ],
  2027: [
    { key: 'tet_28', solarDate: '2027-02-04', name: 'Tết Nguyên Đán (28 Tết)', calendarType: 'lunar', lunarDateLabel: '28/12 Âm lịch' },
    { key: 'tet_29', solarDate: '2027-02-05', name: 'Tết Nguyên Đán (29 Tết)', calendarType: 'lunar', lunarDateLabel: '29/12 Âm lịch' },
    { key: 'tet_1', solarDate: '2027-02-06', name: 'Mùng 1 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '1/1 Âm lịch' },
    { key: 'tet_2', solarDate: '2027-02-07', name: 'Mùng 2 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '2/1 Âm lịch' },
    { key: 'tet_3', solarDate: '2027-02-08', name: 'Mùng 3 Tết Nguyên Đán', calendarType: 'lunar', lunarDateLabel: '3/1 Âm lịch' },
    { key: 'tet_comp_1', solarDate: '2027-02-09', name: 'Tết Nguyên Đán (Nghỉ bù)', calendarType: 'compensatory', lunarDateLabel: '4/1 Âm lịch' },
    { key: 'tet_comp_2', solarDate: '2027-02-10', name: 'Tết Nguyên Đán (Nghỉ bù)', calendarType: 'compensatory', lunarDateLabel: '5/1 Âm lịch' },
    { key: 'labor_comp', solarDate: '2027-05-03', name: 'Ngày Quốc tế Lao động (Nghỉ bù)', calendarType: 'compensatory' },
    { key: 'national_day_adj', solarDate: '2027-09-03', name: 'Ngày Quốc khánh (Nghỉ liền kề)', calendarType: 'solar' },
  ],
}

const DEFAULT_TET_NAMES: Readonly<Record<number, string>> = {
  1: 'Mùng 1 Tết Nguyên Đán',
  2: 'Mùng 2 Tết Nguyên Đán',
  3: 'Mùng 3 Tết Nguyên Đán',
  4: 'Tết Nguyên Đán (Mùng 4)',
  5: 'Tết Nguyên Đán (Mùng 5)',
}

const isSupportedLunarYear = (year: number): boolean =>
  year >= LUNAR_SUPPORTED_MIN_YEAR && year <= LUNAR_SUPPORTED_MAX_YEAR

const dayOfWeekUtc = (ordinal: number): number => new Date(ordinal * 86_400_000).getUTCDay()

const findNextWorkdayOrdinal = (startOrdinal: number, occupied: ReadonlySet<number>): number => {
  let cursor = startOrdinal + 1
  while (dayOfWeekUtc(cursor) === 0 || dayOfWeekUtc(cursor) === 6 || occupied.has(cursor)) {
    cursor += 1
  }
  return cursor
}

const parseIsoDateParts = (isoDate: string): DateOnlyParts | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  }
}

const normalizeRemoteHolidayName = (rawName: string, calendarType: HolidayCalendarType): string => {
  const trimmed = rawName.trim()
  if (!trimmed || trimmed.includes('(')) return trimmed

  if (/hoán đổi/i.test(trimmed)) {
    const base = trimmed.replace(/^(nghỉ\s*)?hoán đổi\s*(dịp\s*)?/i, '').trim()
    return base ? `${base} (Ngày hoán đổi)` : trimmed
  }
  if (/nghỉ bù/i.test(trimmed) || calendarType === 'compensatory') {
    const base = trimmed.replace(/^nghỉ bù\s*/i, '').trim()
    return base ? `${base} (Nghỉ bù)` : `${trimmed} (Nghỉ bù)`
  }
  return trimmed
}

export const parseRemoteYearHolidays = (payload: unknown): RemoteHolidayEntry[] => {
  const rawList: unknown[] = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null && Array.isArray((payload as { holidays?: unknown }).holidays)
      ? ((payload as { holidays: unknown[] }).holidays)
      : []

  const results: RemoteHolidayEntry[] = []
  for (const entry of rawList) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const rawDate = typeof record.date === 'string' ? record.date : typeof record.solarDate === 'string' ? record.solarDate : ''
    const rawName = typeof record.name === 'string' ? record.name : typeof record.title === 'string' ? record.title : ''
    const solarDate = rawDate.slice(0, 10)
    if (!parseIsoDateParts(solarDate) || !rawName.trim()) continue

    const rawType = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    const isOff = typeof record.isOff === 'boolean' ? record.isOff : rawType !== 'workday'
    if (!isOff) continue

    const calendarType: HolidayCalendarType =
      rawType.includes('in-lieu') || rawType.includes('compensatory') || rawType.includes('swap')
        ? 'compensatory'
        : 'solar'

    results.push({
      solarDate,
      name: normalizeRemoteHolidayName(rawName, calendarType),
      calendarType,
      isDayOff: true,
    })
  }
  return results
}

const fetchVietnameseDaysYear: RemoteHolidayProvider = async (year) => {
  if (year < REMOTE_MIN_YEAR || typeof fetch !== 'function') return null
  try {
    const response = await fetch(`https://cdn.jsdelivr.net/npm/vietnamese-days/dist/years/${year}.json`, {
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const json: unknown = await response.json()
    const parsed = parseRemoteYearHolidays(json)
    return parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export class VietnameseHolidaysService {
  private readonly remoteCache = new Map<number, RemoteCacheEntry>()

  public constructor(
    private readonly lunarProvider: LunarDateProvider = vietnameseLunarAdapter,
    private readonly remoteProvider: RemoteHolidayProvider = fetchVietnameseDaysYear,
  ) { }

  private async getRemoteYearEntries(year: number): Promise<readonly RemoteHolidayEntry[] | null> {
    if (OFFICIAL_PUBLIC_HOLIDAY_OVERRIDES[year] || year < REMOTE_MIN_YEAR) {
      return null
    }

    const now = Date.now()
    const cached = this.remoteCache.get(year)
    if (cached && cached.expiresAt > now) {
      return cached.items
    }

    const items = await this.remoteProvider(year)
    this.remoteCache.set(year, {
      items,
      expiresAt: now + (items ? REMOTE_CACHE_HIT_TTL_MS : REMOTE_CACHE_MISS_TTL_MS),
    })
    return items
  }

  private buildYearHolidays(year: number, remoteEntries: readonly RemoteHolidayEntry[] | null): VietnameseHolidayItem[] {
    const items: VietnameseHolidayItem[] = []
    const overrides = OFFICIAL_PUBLIC_HOLIDAY_OVERRIDES[year]
    const hasOverride = Boolean(overrides)
    const hasRemote = Boolean(remoteEntries && remoteEntries.length > 0)
    const publicDayOffOrdinals = new Set<number>()
    const publicBaseHolidaysForAutoComp: Array<{ ordinal: number; key: string; name: string }> = []

    const addHoliday = (item: VietnameseHolidayItem, ordinal?: number) => {
      items.push(item)
      if (item.isDayOff && ordinal !== undefined) {
        publicDayOffOrdinals.add(ordinal)
      }
    }

    // 1. Các ngày lễ Dương lịch cố định theo Bộ luật Lao động & Nghị quyết mới
    const yearFixedSolarPublic: FixedHolidayRule[] = [...FIXED_SOLAR_PUBLIC_HOLIDAYS]
    if (year >= 2027) {
      yearFixedSolarPublic.push({
        key: 'war_invalids_public',
        month: 7,
        day: 27,
        name: 'Ngày Tổ quốc tri ân - Ngày Thương binh, liệt sĩ',
        category: 'public_holiday',
      })
    }
    if (year >= 2026) {
      yearFixedSolarPublic.push({
        key: 'culture_day',
        month: 11,
        day: 24,
        name: 'Ngày Văn hóa Việt Nam',
        category: 'public_holiday',
      })
    }

    for (const rule of yearFixedSolarPublic) {
      const parts: DateOnlyParts = { year, month: rule.month, day: rule.day }
      const solarDate = formatIsoDateOnly(parts)
      const ordinal = dateOnlyToOrdinal(parts)
      addHoliday(
        {
          id: `${solarDate}:${rule.key}`,
          solarDate,
          name: rule.name,
          category: 'public_holiday',
          calendarType: 'solar',
          isDayOff: true,
        },
        ordinal,
      )
      if (!hasOverride && !hasRemote) {
        publicBaseHolidaysForAutoComp.push({ ordinal, key: rule.key, name: rule.name })
      }
    }

    // 2. Các ngày kỷ niệm Dương lịch (27/7 trước 2027 là ngày kỷ niệm)
    const yearFixedSolarObservances: FixedHolidayRule[] = [...FIXED_SOLAR_OBSERVANCES]
    if (year < 2027) {
      yearFixedSolarObservances.push({
        key: 'war_invalids',
        month: 7,
        day: 27,
        name: 'Ngày Thương binh - Liệt sĩ',
        category: 'observance',
      })
    }

    for (const rule of yearFixedSolarObservances) {
      const solarDate = formatIsoDateOnly({ year, month: rule.month, day: rule.day })
      addHoliday({
        id: `${solarDate}:${rule.key}`,
        solarDate,
        name: rule.name,
        category: 'observance',
        calendarType: 'solar',
        isDayOff: false,
      })
    }

    // 3. Áp dụng cấu hình nghỉ lễ chính thức theo năm (2024–2027) hoặc từ API ngoài
    if (overrides) {
      for (const entry of overrides) {
        const parts = parseIsoDateParts(entry.solarDate)
        if (!parts) continue
        const ordinal = dateOnlyToOrdinal(parts)
        addHoliday(
          {
            id: `${entry.solarDate}:${entry.key}`,
            solarDate: entry.solarDate,
            name: entry.name,
            category: 'public_holiday',
            calendarType: entry.calendarType,
            isDayOff: true,
            ...(entry.lunarDateLabel ? { lunarDateLabel: entry.lunarDateLabel } : {}),
          },
          ordinal,
        )
      }
    } else if (remoteEntries) {
      remoteEntries.forEach((entry, index) => {
        const parts = parseIsoDateParts(entry.solarDate)
        if (!parts) return
        const ordinal = dateOnlyToOrdinal(parts)
        if (publicDayOffOrdinals.has(ordinal)) return
        addHoliday(
          {
            id: `${entry.solarDate}:remote_${index}`,
            solarDate: entry.solarDate,
            name: entry.name,
            category: 'public_holiday',
            calendarType: entry.calendarType,
            isDayOff: true,
          },
          ordinal,
        )
      })
    }

    // 4. Các ngày lễ Âm lịch (Giỗ Tổ 10/3, Tết khi chưa override/remote, và ngày lễ truyền thống)
    if (isSupportedLunarYear(year)) {
      const jan1Ordinal = dateOnlyToOrdinal({ year, month: 1, day: 1 })
      const dec31Ordinal = dateOnlyToOrdinal({ year, month: 12, day: 31 })

      for (let ordinal = jan1Ordinal; ordinal <= dec31Ordinal; ordinal += 1) {
        const parts = dateOnlyFromOrdinal(ordinal)
        const lunar = this.lunarProvider.convert(parts)
        if (lunar.isLeapMonth) continue

        const solarDate = lunar.solarDate
        const lunarDateLabel = `${lunar.lunarDay}/${lunar.lunarMonth} Âm lịch`

        // Giỗ Tổ Hùng Vương (10/3 Âm lịch): chính thức là ngày nghỉ lễ từ năm 2007.
        if (lunar.lunarMonth === 3 && lunar.lunarDay === 10) {
          const isOfficialDayOff = year >= 2007
          if (!publicDayOffOrdinals.has(ordinal)) {
            addHoliday(
              {
                id: `${solarDate}:hung_kings`,
                solarDate,
                name: 'Giỗ Tổ Hùng Vương',
                category: isOfficialDayOff ? 'public_holiday' : 'observance',
                calendarType: 'lunar',
                isDayOff: isOfficialDayOff,
                lunarDateLabel,
              },
              isOfficialDayOff ? ordinal : undefined,
            )
          }
          if (!hasOverride && !hasRemote && isOfficialDayOff) {
            publicBaseHolidaysForAutoComp.push({ ordinal, key: 'hung_kings', name: 'Giỗ Tổ Hùng Vương' })
          }
        }

        // Tết Nguyên Đán tự động cho các năm không có override hoặc API ngoài
        if (!hasOverride && !hasRemote && lunar.lunarMonth === 1 && lunar.lunarDay >= 1 && lunar.lunarDay <= 5) {
          const tetName = DEFAULT_TET_NAMES[lunar.lunarDay] ?? `Tết Nguyên Đán (Mùng ${lunar.lunarDay})`
          addHoliday(
            {
              id: `${solarDate}:tet_${lunar.lunarDay}`,
              solarDate,
              name: tetName,
              category: 'public_holiday',
              calendarType: 'lunar',
              isDayOff: true,
              lunarDateLabel,
            },
            ordinal,
          )
        }

        for (const rule of FIXED_LUNAR_OBSERVANCES) {
          if (lunar.lunarMonth === rule.month && lunar.lunarDay === rule.day) {
            addHoliday({
              id: `${solarDate}:${rule.key}`,
              solarDate,
              name: rule.name,
              category: 'observance',
              calendarType: 'lunar',
              isDayOff: false,
              lunarDateLabel,
            })
          }
        }
      }
    }

    // 5. Tự động tính ngày nghỉ bù nếu ngày nghỉ lễ rơi vào Thứ Bảy / Chủ Nhật
    if (!hasOverride && !hasRemote) {
      for (const holiday of publicBaseHolidaysForAutoComp) {
        const dow = dayOfWeekUtc(holiday.ordinal)
        if (dow === 0 || dow === 6) {
          const compOrdinal = findNextWorkdayOrdinal(holiday.ordinal, publicDayOffOrdinals)
          const compDate = formatIsoDateOnly(dateOnlyFromOrdinal(compOrdinal))
          addHoliday(
            {
              id: `${compDate}:${holiday.key}_comp`,
              solarDate: compDate,
              name: `${holiday.name} (Nghỉ bù)`,
              category: 'public_holiday',
              calendarType: 'compensatory',
              isDayOff: true,
            },
            compOrdinal,
          )
        }
      }
    }

    return items
  }

  public async getHolidays(fromValue: unknown, toValue: unknown): Promise<VietnameseHolidayItem[]> {
    const { from, to, startOrdinal, endOrdinal } = validateDateRangeWindow(fromValue, toValue)
    const fromIso = formatIsoDateOnly(from)
    const toIso = formatIsoDateOnly(to)

    const years = new Set<number>()
    for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
      years.add(dateOnlyFromOrdinal(ordinal).year)
    }

    const remoteByYear = new Map<number, readonly RemoteHolidayEntry[] | null>()
    await Promise.all(
      Array.from(years).map(async (year) => {
        remoteByYear.set(year, await this.getRemoteYearEntries(year))
      }),
    )

    const collected: VietnameseHolidayItem[] = []
    for (const year of years) {
      const yearItems = this.buildYearHolidays(year, remoteByYear.get(year) ?? null)
      for (const item of yearItems) {
        if (item.solarDate >= fromIso && item.solarDate <= toIso) {
          collected.push(item)
        }
      }
    }

    return collected.sort((left, right) => {
      if (left.solarDate !== right.solarDate) return left.solarDate < right.solarDate ? -1 : 1
      if (left.category !== right.category) return left.category === 'public_holiday' ? -1 : 1
      return left.name.localeCompare(right.name, 'vi')
    })
  }
}

export const vietnameseHolidaysService = new VietnameseHolidaysService()
