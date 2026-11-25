import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '@/shared/errors/app-error.js'
import { VietnameseHolidaysService } from '@/modules/calendar/services/vietnamese-holidays.service.js'
import { vietnameseLunarAdapter } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'

const offlineService = new VietnameseHolidaysService(vietnameseLunarAdapter, async () => null)

test('returns 2026 solar, lunar, swap, compensatory, and Culture Day holidays with parenthetical suffixes', async () => {
  const holidays = await offlineService.getHolidays('2026-01-01', '2026-12-31')
  const byDateAndName = new Map(holidays.map((item) => [`${item.solarDate}:${item.name}`, item]))

  assert.equal(byDateAndName.get('2026-01-01:Tết Dương lịch')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-01-02:Tết Dương lịch (Ngày hoán đổi)')?.calendarType, 'compensatory')
  assert.equal(byDateAndName.get('2026-02-17:Mùng 1 Tết Nguyên Đán')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-04-26:Giỗ Tổ Hùng Vương')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-04-27:Giỗ Tổ Hùng Vương (Nghỉ bù)')?.calendarType, 'compensatory')

  assert.equal(byDateAndName.get('2026-07-27:Ngày Thương binh - Liệt sĩ')?.category, 'observance')
  assert.equal(byDateAndName.get('2026-07-27:Ngày Thương binh - Liệt sĩ')?.isDayOff, false)

  assert.equal(byDateAndName.get('2026-08-31:Ngày Quốc khánh (Ngày hoán đổi)')?.calendarType, 'compensatory')
  assert.equal(byDateAndName.get('2026-09-01:Ngày Quốc khánh (Nghỉ liền kề)')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-09-02:Ngày Quốc khánh')?.category, 'public_holiday')

  assert.equal(byDateAndName.get('2026-11-24:Ngày Văn hóa Việt Nam')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-11-24:Ngày Văn hóa Việt Nam')?.isDayOff, true)

  assert.equal(byDateAndName.get('2026-09-25:Tết Trung thu')?.category, 'observance')
  assert.equal(byDateAndName.get('2026-09-25:Tết Trung thu')?.lunarDateLabel, '15/8 Âm lịch')
})

test('promotes 27/7 to official public holiday from 2027 and fixes 2027 Tet compensatory dates', async () => {
  const holidays = await offlineService.getHolidays('2027-02-01', '2027-11-30')
  const byDateAndName = new Map(holidays.map((item) => [`${item.solarDate}:${item.name}`, item]))

  assert.equal(byDateAndName.get('2027-02-09:Tết Nguyên Đán (Nghỉ bù)')?.isDayOff, true)
  assert.equal(byDateAndName.get('2027-02-10:Tết Nguyên Đán (Nghỉ bù)')?.isDayOff, true)
  assert.equal(byDateAndName.get('2027-02-11:Tết Nguyên Đán (Nghỉ bù)'), undefined)
  assert.equal(byDateAndName.get('2027-05-03:Ngày Quốc tế Lao động (Nghỉ bù)')?.calendarType, 'compensatory')
  assert.equal(byDateAndName.get('2027-07-27:Ngày Tổ quốc tri ân - Ngày Thương binh, liệt sĩ')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2027-07-27:Ngày Tổ quốc tri ân - Ngày Thương binh, liệt sĩ')?.isDayOff, true)
  assert.equal(byDateAndName.get('2027-11-24:Ngày Văn hóa Việt Nam')?.category, 'public_holiday')
})

test('separates 2025 official holiday swaps and adjacent national day without 24/11', async () => {
  const holidays = await offlineService.getHolidays('2025-01-25', '2025-11-30')
  const dayOffDates = new Set(holidays.filter((h) => h.isDayOff).map((h) => h.solarDate))

  assert.ok(dayOffDates.has('2025-01-27'))
  assert.ok(dayOffDates.has('2025-05-02'))
  assert.ok(dayOffDates.has('2025-09-01'))
  assert.ok(dayOffDates.has('2025-09-02'))
  assert.ok(!dayOffDates.has('2025-11-24'))
})

test('merges remote yearly decrees for years outside 2024-2027 and falls back automatically when offline', async () => {
  const remoteService = new VietnameseHolidaysService(vietnameseLunarAdapter, async (year) => {
    if (year !== 2028) return null
    return [
      { solarDate: '2028-01-26', name: 'Mùng 1 Tết Nguyên Đán', calendarType: 'solar', isDayOff: true },
      { solarDate: '2028-05-02', name: 'Ngày Quốc tế Lao động (Nghỉ bù)', calendarType: 'compensatory', isDayOff: true },
    ]
  })

  const remote2028 = await remoteService.getHolidays('2028-01-01', '2028-11-30')
  assert.ok(remote2028.some((h) => h.solarDate === '2028-05-02' && h.name === 'Ngày Quốc tế Lao động (Nghỉ bù)'))
  assert.ok(remote2028.some((h) => h.solarDate === '2028-11-24' && h.category === 'public_holiday'))

  const fallback2028 = await offlineService.getHolidays('2028-01-01', '2028-09-10')
  const compMay = fallback2028.find((h) => h.solarDate === '2028-05-02' && h.calendarType === 'compensatory')
  const tet1 = fallback2028.find((h) => h.name === 'Mùng 1 Tết Nguyên Đán')
  const national2028 = fallback2028.find((h) => h.solarDate === '2028-09-02' && h.name === 'Ngày Quốc khánh')
  const guessedAdj2028 = fallback2028.find(
    (h) => h.solarDate === '2028-09-03' && h.category === 'public_holiday',
  )

  assert.ok(compMay, 'Expected automatic compensatory day off on 2028-05-02')
  assert.equal(tet1?.solarDate, '2028-01-26')
  assert.ok(national2028, 'Expected fixed National Day on 2028-09-02')
  assert.equal(guessedAdj2028, undefined, 'Should not guess adjacent National Day 03/09 without decree/API')
})

test('rejects invalid or oversized date ranges for holidays', async () => {
  await assert.rejects(
    () => offlineService.getHolidays('2026-05-01', '2026-04-01'),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_LUNAR_DATE_RANGE',
  )
  await assert.rejects(
    () => offlineService.getHolidays('2026-01-01', '2027-02-05'),
    (error: unknown) => error instanceof AppError && error.code === 'LUNAR_DATE_RANGE_TOO_LARGE',
  )
})
