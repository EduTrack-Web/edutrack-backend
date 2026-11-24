import { AppError } from '@/shared/errors/app-error.js'
import type { DateOnlyParts, VietnameseLunarDate } from '@/modules/calendar/types/calendar.types.js'
import { convertVietnameseSolarToLunar } from '@/modules/calendar/services/vietnamese-lunar.engine.js'
import { formatIsoDateOnly } from '@/modules/calendar/validations/lunar-calendar.validation.js'

export interface LunarDateProvider {
  convert(date: DateOnlyParts): VietnameseLunarDate
}

const isValidConversion = (
  value: ReturnType<typeof convertVietnameseSolarToLunar>,
): boolean =>
  Number.isSafeInteger(value.day)
  && value.day >= 1
  && value.day <= 30
  && Number.isSafeInteger(value.month)
  && value.month >= 1
  && value.month <= 12
  && Number.isSafeInteger(value.year)
  && (value.monthSize === 29 || value.monthSize === 30)

/**
 * Xác định múi giờ tính âm lịch theo mốc lịch sử Việt Nam:
 * - Từ 08/08/1967 trở đi (miền Bắc và cả nước từ 1976): UTC+7.
 * - Trước 08/08/1967: UTC+8 (theo lịch Hiệp Kỷ / Vạn niên thư / miền Bắc trước 1968).
 * - Giai đoạn 1955-07-01..1959-12-31 và 1967-08-08..1975-12-31 hai miền dùng múi giờ khác nhau.
 */
const resolveVietnamHistoricalOffsets = (
  isoDate: string,
): { primaryOffset: number; southOffset?: number } => {
  if (isoDate >= '1976-01-01') return { primaryOffset: 7 }
  if (isoDate >= '1967-08-08') return { primaryOffset: 7, southOffset: 8 }
  if (isoDate >= '1955-07-01' && isoDate <= '1959-12-31') return { primaryOffset: 8, southOffset: 7 }
  return { primaryOffset: 8 }
}

export const vietnameseLunarAdapter: LunarDateProvider = {
  convert(date) {
    try {
      const solarDate = formatIsoDateOnly(date)
      const { primaryOffset, southOffset } = resolveVietnamHistoricalOffsets(solarDate)
      const lunarDate = convertVietnameseSolarToLunar(date.year, date.month, date.day, primaryOffset)
      if (!isValidConversion(lunarDate)) {
        throw new Error('Lunar conversion postcondition failed')
      }

      const result: VietnameseLunarDate = {
        solarDate,
        lunarDay: lunarDate.day,
        lunarMonth: lunarDate.month,
        lunarYear: lunarDate.year,
        isLeapMonth: lunarDate.isLeapMonth,
      }

      if (southOffset !== undefined) {
        const southLunar = convertVietnameseSolarToLunar(date.year, date.month, date.day, southOffset)
        if (
          isValidConversion(southLunar)
          && (
            southLunar.day !== lunarDate.day
            || southLunar.month !== lunarDate.month
            || southLunar.year !== lunarDate.year
            || southLunar.isLeapMonth !== lunarDate.isLeapMonth
          )
        ) {
          result.alternateLunar = {
            label: 'Miền Nam',
            lunarDay: southLunar.day,
            lunarMonth: southLunar.month,
            lunarYear: southLunar.year,
            isLeapMonth: southLunar.isLeapMonth,
          }
        }
      }

      return result
    } catch {
      throw new AppError(
        422,
        'LUNAR_DATE_UNSUPPORTED',
        'Không thể quy đổi ngày Âm cho ngày đã chọn. Lịch Dương vẫn được giữ nguyên.',
      )
    }
  },
}
