import type {
  DateOnlyParts,
  HolidayLunarDateInfo,
  OfficialHolidayEntry,
  OfficialHolidayYearRecord,
  VietnameseHolidayItem,
} from '@/modules/calendar/types/calendar.types.js'
import {
  officialHolidayYearRepository,
  type OfficialHolidayYearRepository,
} from '@/modules/calendar/repositories/official-holiday-year.repository.js'
import { vietnameseLunarAdapter, type LunarDateProvider } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'
import {
  dateOnlyFromOrdinal,
  dateOnlyToOrdinal,
  formatIsoDateOnly,
  LUNAR_SUPPORTED_MAX_YEAR,
  LUNAR_SUPPORTED_MIN_YEAR,
  parseIsoDateOnly,
  validateDateRangeWindow,
} from '@/modules/calendar/validations/lunar-calendar.validation.js'

interface FixedHolidayRule {
  key: string
  month: number
  day: number
  name: string
}

interface InternalHolidayEntry {
  ruleKey: string
  item: VietnameseHolidayItem
}

interface L1YearCacheEntry {
  version: number | null
  record: OfficialHolidayYearRecord | null
  checkedAt: number
}

export interface VietnameseHolidaysServiceOptions {
  cacheTtlMs?: number
  nowProvider?: () => number
}

const DEFAULT_L1_CACHE_TTL_MS = 60_000

const FIXED_SOLAR_PUBLIC_HOLIDAYS: readonly FixedHolidayRule[] = [
  { key: 'new_year', month: 1, day: 1, name: 'Tết Dương lịch' },
  { key: 'reunification', month: 4, day: 30, name: 'Ngày Chiến thắng' },
  { key: 'labor_day', month: 5, day: 1, name: 'Ngày Quốc tế Lao động' },
  { key: 'national_day', month: 9, day: 2, name: 'Ngày Quốc khánh' },
]

const FIXED_SOLAR_OBSERVANCES: readonly FixedHolidayRule[] = [
  { key: 'party_founding', month: 2, day: 3, name: 'Ngày thành lập Đảng CSVN' },
  { key: 'valentine', month: 2, day: 14, name: 'Lễ Tình nhân' },
  { key: 'doctors_day', month: 2, day: 27, name: 'Ngày Thầy thuốc Việt Nam' },
  { key: 'womens_day', month: 3, day: 8, name: 'Ngày Quốc tế Phụ nữ' },
  { key: 'youth_union', month: 3, day: 26, name: 'Ngày thành lập Đoàn TNCS HCM' },
  { key: 'childrens_day', month: 6, day: 1, name: 'Ngày Quốc tế Thiếu nhi' },
  { key: 'family_day', month: 6, day: 28, name: 'Ngày Gia đình Việt Nam' },
  { key: 'august_revolution', month: 8, day: 19, name: 'Ngày Cách mạng tháng Tám' },
  { key: 'vn_womens_day', month: 10, day: 20, name: 'Ngày Phụ nữ Việt Nam' },
  { key: 'teachers_day', month: 11, day: 20, name: 'Ngày Nhà giáo Việt Nam' },
  { key: 'army_day', month: 12, day: 22, name: 'Ngày thành lập QĐND Việt Nam' },
  { key: 'christmas', month: 12, day: 25, name: 'Lễ Giáng sinh' },
]

const FIXED_LUNAR_OBSERVANCES: readonly FixedHolidayRule[] = [
  { key: 'lantern_festival', month: 1, day: 15, name: 'Rằm tháng Giêng' },
  { key: 'cold_food', month: 3, day: 3, name: 'Tết Hàn Thực' },
  { key: 'buddha_birthday', month: 4, day: 15, name: 'Lễ Phật Đản' },
  { key: 'doan_ngo', month: 5, day: 5, name: 'Tết Đoan Ngọ' },
  { key: 'vu_lan', month: 7, day: 15, name: 'Lễ Vu Lan' },
  { key: 'mid_autumn', month: 8, day: 15, name: 'Tết Trung thu' },
  { key: 'kitchen_gods', month: 12, day: 23, name: 'Ông Công Ông Táo' },
]

const DEFAULT_TET_CORE_NAMES: Readonly<Record<number, string>> = {
  1: 'Mùng 1 Tết Nguyên Đán',
  2: 'Mùng 2 Tết Nguyên Đán',
  3: 'Mùng 3 Tết Nguyên Đán',
}

const HEAVENLY_STEMS = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'] as const
const EARTHLY_BRANCHES = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'] as const

export const getLunarYearCanChi = (lunarYear: number): string => {
  const stem = HEAVENLY_STEMS[(((lunarYear + 6) % 10) + 10) % 10]
  const branch = EARTHLY_BRANCHES[(((lunarYear + 8) % 12) + 12) % 12]
  return `${stem} ${branch}`
}

const isSupportedLunarYear = (year: number): boolean =>
  year >= LUNAR_SUPPORTED_MIN_YEAR && year <= LUNAR_SUPPORTED_MAX_YEAR

const normalizeComparableName = (name: string): string =>
  name.trim().toLocaleLowerCase('vi')

const isSamePublicSemanticHoliday = (
  ruleEntry: InternalHolidayEntry,
  officialEntry: OfficialHolidayEntry,
): boolean => {
  if (ruleEntry.item.category !== 'public_holiday') return false
  if (ruleEntry.item.solarDate !== officialEntry.solarDate) return false
  if (officialEntry.replacesRuleKey && officialEntry.replacesRuleKey === ruleEntry.ruleKey) return true
  if (ruleEntry.ruleKey === officialEntry.key) return true
  return normalizeComparableName(ruleEntry.item.name) === normalizeComparableName(officialEntry.name)
}

export class VietnameseHolidaysService {
  private readonly l1Cache = new Map<number, L1YearCacheEntry>()
  private readonly inFlightYearLoads = new Map<number, Promise<OfficialHolidayYearRecord | null>>()
  private readonly cacheTtlMs: number
  private readonly nowProvider: () => number

  public constructor(
    private readonly lunarProvider: LunarDateProvider = vietnameseLunarAdapter,
    private readonly officialRepository: OfficialHolidayYearRepository = officialHolidayYearRepository,
    options: VietnameseHolidaysServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_L1_CACHE_TTL_MS
    this.nowProvider = options.nowProvider ?? Date.now
  }

  public invalidateYear(year: number): void {
    this.l1Cache.delete(year)
  }

  public clearCache(): void {
    this.l1Cache.clear()
  }

  /**
   * Nhóm A: Sinh toàn bộ ngày lễ/kỷ niệm theo quy tắc cố định và lịch Âm Việt Nam.
   * Luôn giữ Mùng 1–3 Tết Nguyên Đán và các ngày lễ cố định; không suy đoán ngày nghỉ bù/hoán đổi.
   */
  private buildRuleBasedHolidays(year: number): InternalHolidayEntry[] {
    const entries: InternalHolidayEntry[] = []

    const yearFixedSolarPublic: FixedHolidayRule[] = [...FIXED_SOLAR_PUBLIC_HOLIDAYS]
    if (year >= 2027) {
      yearFixedSolarPublic.push({
        key: 'war_invalids_public',
        month: 7,
        day: 27,
        name: 'Ngày Tổ quốc tri ân - Ngày Thương binh, liệt sĩ',
      })
    }
    if (year >= 2026) {
      yearFixedSolarPublic.push({
        key: 'culture_day',
        month: 11,
        day: 24,
        name: 'Ngày Văn hóa Việt Nam',
      })
    }

    for (const rule of yearFixedSolarPublic) {
      const solarDate = formatIsoDateOnly({ year, month: rule.month, day: rule.day })
      entries.push({
        ruleKey: rule.key,
        item: {
          id: `${solarDate}:${rule.key}`,
          solarDate,
          name: rule.name,
          category: 'public_holiday',
          calendarType: 'solar',
          isDayOff: true,
          sourceGroup: 'rule',
        },
      })
    }

    const yearFixedSolarObservances: FixedHolidayRule[] = [...FIXED_SOLAR_OBSERVANCES]
    if (year < 2027) {
      yearFixedSolarObservances.push({
        key: 'war_invalids',
        month: 7,
        day: 27,
        name: 'Ngày Thương binh - Liệt sĩ',
      })
    }

    for (const rule of yearFixedSolarObservances) {
      const solarDate = formatIsoDateOnly({ year, month: rule.month, day: rule.day })
      entries.push({
        ruleKey: rule.key,
        item: {
          id: `${solarDate}:${rule.key}`,
          solarDate,
          name: rule.name,
          category: 'observance',
          calendarType: 'solar',
          isDayOff: false,
          sourceGroup: 'rule',
        },
      })
    }

    if (isSupportedLunarYear(year)) {
      const jan1Ordinal = dateOnlyToOrdinal({ year, month: 1, day: 1 })
      const dec31Ordinal = dateOnlyToOrdinal({ year, month: 12, day: 31 })

      for (let ordinal = jan1Ordinal; ordinal <= dec31Ordinal; ordinal += 1) {
        const parts: DateOnlyParts = dateOnlyFromOrdinal(ordinal)
        const lunar = this.lunarProvider.convert(parts)
        if (lunar.isLeapMonth) continue

        const solarDate = lunar.solarDate
        const lunarDateLabel = `${lunar.lunarDay}/${lunar.lunarMonth} Âm lịch`

        if (lunar.lunarMonth === 3 && lunar.lunarDay === 10) {
          const isOfficialDayOff = year >= 2007
          entries.push({
            ruleKey: 'hung_kings',
            item: {
              id: `${solarDate}:hung_kings`,
              solarDate,
              name: 'Giỗ Tổ Hùng Vương',
              category: isOfficialDayOff ? 'public_holiday' : 'observance',
              calendarType: 'lunar',
              isDayOff: isOfficialDayOff,
              lunarDateLabel,
              sourceGroup: 'rule',
            },
          })
        }

        if (lunar.lunarMonth === 1 && lunar.lunarDay >= 1 && lunar.lunarDay <= 3) {
          const ruleKey = `tet_${lunar.lunarDay}`
          entries.push({
            ruleKey,
            item: {
              id: `${solarDate}:${ruleKey}`,
              solarDate,
              name: DEFAULT_TET_CORE_NAMES[lunar.lunarDay] ?? `Mùng ${lunar.lunarDay} Tết Nguyên Đán`,
              category: 'public_holiday',
              calendarType: 'lunar',
              isDayOff: true,
              lunarDateLabel,
              sourceGroup: 'rule',
            },
          })
        }

        for (const rule of FIXED_LUNAR_OBSERVANCES) {
          if (lunar.lunarMonth === rule.month && lunar.lunarDay === rule.day) {
            entries.push({
              ruleKey: rule.key,
              item: {
                id: `${solarDate}:${rule.key}`,
                solarDate,
                name: rule.name,
                category: 'observance',
                calendarType: 'lunar',
                isDayOff: false,
                lunarDateLabel,
                sourceGroup: 'rule',
              },
            })
          }
        }
      }
    }

    return entries
  }

  /**
   * Đọc Nhóm B cho tập các năm qua L1 RAM cache + kiểm tra version trên L2 MongoDB + in-flight deduplication.
   * Khi MongoDB gặp sự cố, ghi log cảnh báo và trả rỗng để Nhóm A vẫn hoạt động bình thường.
   */
  private async loadConfirmedOfficialYears(
    years: readonly number[],
  ): Promise<Map<number, OfficialHolidayYearRecord | null>> {
    const result = new Map<number, OfficialHolidayYearRecord | null>()
    const now = this.nowProvider()
    const yearsToRefresh: number[] = []

    for (const year of years) {
      const cached = this.l1Cache.get(year)
      if (cached && now - cached.checkedAt < this.cacheTtlMs) {
        result.set(year, cached.record)
      } else {
        yearsToRefresh.push(year)
      }
    }

    if (yearsToRefresh.length === 0) return result

    const pendingPromises: Array<Promise<void>> = []
    const uncoordinatedYears: number[] = []

    for (const year of yearsToRefresh) {
      const existingPromise = this.inFlightYearLoads.get(year)
      if (existingPromise) {
        pendingPromises.push(
          existingPromise.then((record) => {
            result.set(year, record)
          }),
        )
      } else {
        uncoordinatedYears.push(year)
      }
    }

    if (uncoordinatedYears.length > 0) {
      const batchPromise = this.fetchAndCacheYearsFromL2(uncoordinatedYears)
      for (const year of uncoordinatedYears) {
        const yearPromise = batchPromise.then((map) => map.get(year) ?? null)
        this.inFlightYearLoads.set(year, yearPromise)
        pendingPromises.push(
          yearPromise
            .then((record) => {
              result.set(year, record)
            })
            .finally(() => {
              if (this.inFlightYearLoads.get(year) === yearPromise) {
                this.inFlightYearLoads.delete(year)
              }
            }),
        )
      }
    }

    await Promise.all(pendingPromises)
    return result
  }

  private async fetchAndCacheYearsFromL2(
    years: readonly number[],
  ): Promise<Map<number, OfficialHolidayYearRecord | null>> {
    const resolved = new Map<number, OfficialHolidayYearRecord | null>()
    const checkedAt = this.nowProvider()

    try {
      const markers = await this.officialRepository.findVersionMarkers(years)
      const markerByYear = new Map(markers.map((marker) => [marker.year, marker.version]))
      const yearsNeedingFullFetch: number[] = []

      for (const year of years) {
        const dbVersion = markerByYear.get(year) ?? null
        const cached = this.l1Cache.get(year)

        if (cached && cached.version === dbVersion) {
          this.l1Cache.set(year, { ...cached, checkedAt })
          resolved.set(year, cached.record)
        } else if (dbVersion === null) {
          this.l1Cache.set(year, { version: null, record: null, checkedAt })
          resolved.set(year, null)
        } else {
          yearsNeedingFullFetch.push(year)
        }
      }

      if (yearsNeedingFullFetch.length > 0) {
        const records = await this.officialRepository.findConfirmedByYears(yearsNeedingFullFetch)
        const recordByYear = new Map(records.map((rec) => [rec.year, rec]))

        for (const year of yearsNeedingFullFetch) {
          const rec = recordByYear.get(year) ?? null
          this.l1Cache.set(year, {
            version: rec ? rec.version : null,
            record: rec,
            checkedAt,
          })
          resolved.set(year, rec)
        }
      }
    } catch (error: unknown) {
      console.warn(
        '[VietnameseHolidaysService] L2 MongoDB unavailable, serving Group A rule-based holidays:',
        error instanceof Error ? error.message : 'Unknown error',
      )
      for (const year of years) {
        const cached = this.l1Cache.get(year)
        resolved.set(year, cached ? cached.record : null)
      }
    }

    return resolved
  }

  /**
   * Hợp nhất Nhóm A (Rule-based) và Nhóm B (Official Year-specific) có khử trùng ngữ nghĩa.
   * Không cho Nhóm B ghi đè vô điều kiện ngày kỷ niệm hoặc các rule không liên quan của Nhóm A.
   */
  private mergeHolidays(
    ruleEntries: readonly InternalHolidayEntry[],
    officialRecord: OfficialHolidayYearRecord | null,
  ): VietnameseHolidayItem[] {
    if (!officialRecord || officialRecord.status !== 'confirmed') {
      return ruleEntries.map((entry) => entry.item)
    }

    const replacedRuleKeys = new Set<string>()
    for (const official of officialRecord.holidays) {
      if (official.replacesRuleKey) {
        replacedRuleKeys.add(official.replacesRuleKey)
      }
    }

    const merged: VietnameseHolidayItem[] = []
    const matchedOfficialKeys = new Set<string>()

    for (const ruleEntry of ruleEntries) {
      if (replacedRuleKeys.has(ruleEntry.ruleKey)) {
        continue
      }

      const matchingOfficial = officialRecord.holidays.find((official) =>
        isSamePublicSemanticHoliday(ruleEntry, official),
      )

      if (matchingOfficial) {
        matchedOfficialKeys.add(`${matchingOfficial.solarDate}:${matchingOfficial.key}`)
        merged.push({
          id: `${matchingOfficial.solarDate}:${matchingOfficial.key}`,
          solarDate: matchingOfficial.solarDate,
          name: matchingOfficial.name,
          category: 'public_holiday',
          calendarType: matchingOfficial.calendarType,
          isDayOff: matchingOfficial.isDayOff,
          ...(matchingOfficial.lunarDateLabel || ruleEntry.item.lunarDateLabel
            ? { lunarDateLabel: matchingOfficial.lunarDateLabel ?? ruleEntry.item.lunarDateLabel }
            : {}),
          ...(matchingOfficial.notes ? { notes: matchingOfficial.notes } : {}),
          sourceGroup: 'official',
        })
        continue
      }

      merged.push(ruleEntry.item)
    }

    for (const official of officialRecord.holidays) {
      const pairKey = `${official.solarDate}:${official.key}`
      if (matchedOfficialKeys.has(pairKey)) continue

      merged.push({
        id: pairKey,
        solarDate: official.solarDate,
        name: official.name,
        category: 'public_holiday',
        calendarType: official.calendarType,
        isDayOff: official.isDayOff,
        ...(official.lunarDateLabel ? { lunarDateLabel: official.lunarDateLabel } : {}),
        ...(official.notes ? { notes: official.notes } : {}),
        sourceGroup: 'official',
      })
    }

    return merged
  }

  private enrichWithLunarDate(item: VietnameseHolidayItem): VietnameseHolidayItem {
    if (item.lunarDate) return item
    try {
      const parts = parseIsoDateOnly(item.solarDate, 'from')
      if (!isSupportedLunarYear(parts.year)) return item
      const lunar = this.lunarProvider.convert(parts)
      const lunarDate: HolidayLunarDateInfo = {
        day: lunar.lunarDay,
        month: lunar.lunarMonth,
        year: lunar.lunarYear,
        isLeapMonth: lunar.isLeapMonth,
        yearCanChi: getLunarYearCanChi(lunar.lunarYear),
      }
      const leapSuffix = lunar.isLeapMonth ? ' nhuận' : ''
      const lunarDateLabel = item.lunarDateLabel ?? `${lunar.lunarDay}/${lunar.lunarMonth}${leapSuffix} Âm lịch`
      return {
        ...item,
        lunarDateLabel,
        lunarDate,
      }
    } catch {
      return item
    }
  }

  public async getHolidays(fromValue: unknown, toValue: unknown): Promise<VietnameseHolidayItem[]> {
    const { from, to, startOrdinal, endOrdinal } = validateDateRangeWindow(fromValue, toValue)
    const fromIso = formatIsoDateOnly(from)
    const toIso = formatIsoDateOnly(to)

    const years = new Set<number>()
    for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
      years.add(dateOnlyFromOrdinal(ordinal).year)
    }

    const yearList = Array.from(years)
    const officialByYear = await this.loadConfirmedOfficialYears(yearList)

    const collected: VietnameseHolidayItem[] = []
    for (const year of yearList) {
      const ruleEntries = this.buildRuleBasedHolidays(year)
      const yearItems = this.mergeHolidays(ruleEntries, officialByYear.get(year) ?? null)
      for (const item of yearItems) {
        if (item.solarDate >= fromIso && item.solarDate <= toIso) {
          collected.push(this.enrichWithLunarDate(item))
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
