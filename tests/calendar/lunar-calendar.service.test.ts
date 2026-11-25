import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '@/shared/errors/app-error.js'
import { LunarCalendarService } from '@/modules/calendar/services/lunar-calendar.service.js'
import { vietnameseLunarAdapter } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'
import {
  dateOnlyToOrdinal,
  LUNAR_SUPPORTED_MAX_YEAR,
  LUNAR_SUPPORTED_MIN_YEAR,
  MAX_LUNAR_DATE_RANGE_DAYS,
  parseIsoDateOnly,
  validateCalendarPreferencesInput,
  validateLunarDateRange,
} from '@/modules/calendar/validations/lunar-calendar.validation.js'

interface LunarFixture {
  solar: string
  lunar: readonly [day: number, month: number, year: number, isLeapMonth: boolean]
}

const fixtures: LunarFixture[] = [
  { solar: '1900-01-31', lunar: [1, 1, 1900, false] },
  { solar: '1930-01-30', lunar: [1, 1, 1930, false] },
  { solar: '1945-02-13', lunar: [1, 1, 1945, false] },
  { solar: '1954-02-03', lunar: [1, 1, 1954, false] },
  { solar: '1960-01-28', lunar: [1, 1, 1960, false] },
  { solar: '1968-01-29', lunar: [1, 1, 1968, false] },
  { solar: '1975-02-11', lunar: [1, 1, 1975, false] },
  { solar: '1976-01-01', lunar: [1, 12, 1975, false] },
  { solar: '1984-02-02', lunar: [1, 1, 1984, false] },
  { solar: '1985-01-21', lunar: [1, 1, 1985, false] },
  { solar: '1990-07-13', lunar: [21, 5, 1990, true] },
  { solar: '1995-09-25', lunar: [2, 8, 1995, true] },
  { solar: '2000-02-05', lunar: [1, 1, 2000, false] },
  { solar: '2004-03-21', lunar: [1, 2, 2004, true] },
  { solar: '2008-02-07', lunar: [1, 1, 2008, false] },
  { solar: '2012-01-23', lunar: [1, 1, 2012, false] },
  { solar: '2015-02-19', lunar: [1, 1, 2015, false] },
  { solar: '2020-05-23', lunar: [1, 4, 2020, true] },
  { solar: '2023-03-22', lunar: [1, 2, 2023, true] },
  { solar: '2023-04-19', lunar: [29, 2, 2023, true] },
  { solar: '2024-02-10', lunar: [1, 1, 2024, false] },
  { solar: '2025-01-29', lunar: [1, 1, 2025, false] },
  { solar: '2026-02-16', lunar: [29, 12, 2025, false] },
  { solar: '2026-02-17', lunar: [1, 1, 2026, false] },
  { solar: '2030-02-02', lunar: [1, 1, 2030, false] },
  { solar: '2040-02-12', lunar: [1, 1, 2040, false] },
  { solar: '2054-05-06', lunar: [29, 3, 2054, false] },
  { solar: '2054-05-07', lunar: [1, 4, 2054, false] },
  { solar: '2060-02-02', lunar: [1, 1, 2060, false] },
  { solar: '2075-09-10', lunar: [1, 8, 2075, false] },
  { solar: '2099-12-31', lunar: [20, 11, 2099, false] },
  { solar: '2100-02-09', lunar: [1, 1, 2100, false] },
  { solar: '2150-06-15', lunar: [21, 5, 2150, false] },
  { solar: '2199-12-31', lunar: [14, 11, 2199, false] },
]

test('converts verified Vietnamese lunar fixtures across 1900-2199', () => {
  for (const fixture of fixtures) {
    const date = parseIsoDateOnly(fixture.solar, 'from')
    const actual = vietnameseLunarAdapter.convert(date)
    assert.deepEqual(
      [actual.lunarDay, actual.lunarMonth, actual.lunarYear, actual.isLeapMonth],
      fixture.lunar,
      fixture.solar,
    )
  }
})

test('keeps output valid for deterministic random dates across the verified modern range', () => {
  let seed = 0x5eeda11
  const nextRandom = (): number => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    return seed / 0x1_0000_0000
  }

  for (let index = 0; index < 1_000; index += 1) {
    const year = 1900 + Math.floor(nextRandom() * (2199 - 1900 + 1))
    const month = 1 + Math.floor(nextRandom() * 12)
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const day = 1 + Math.floor(nextRandom() * maxDay)
    const actual = vietnameseLunarAdapter.convert({ year, month, day })

    assert.ok(actual.lunarDay >= 1 && actual.lunarDay <= 30)
    assert.ok(actual.lunarMonth >= 1 && actual.lunarMonth <= 12)
    assert.ok(Number.isSafeInteger(actual.lunarYear))
    assert.equal(typeof actual.isLeapMonth, 'boolean')
  }
})

test('returns identical Vietnamese results when the server timezone changes', () => {
  const originalTimeZone = process.env.TZ
  try {
    const results = ['UTC', 'America/Los_Angeles', 'Asia/Ho_Chi_Minh'].map((timeZone) => {
      process.env.TZ = timeZone
      return vietnameseLunarAdapter.convert({ year: 2026, month: 2, day: 17 })
    })
    assert.deepEqual(results[0], results[1])
    assert.deepEqual(results[1], results[2])
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  }
})

test('parses date-only values without accepting normalized or malformed dates', () => {
  assert.deepEqual(parseIsoDateOnly('2024-02-29', 'from'), { year: 2024, month: 2, day: 29 })

  for (const invalid of ['2023-02-29', '2026-02-30', '2026-13-01', '2026-1-01', 'not-a-date']) {
    assert.throws(
      () => parseIsoDateOnly(invalid, 'from'),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_LUNAR_DATE_RANGE',
      invalid,
    )
  }
})

test('accepts exactly 400 days and rejects larger or reversed ranges', () => {
  const valid = validateLunarDateRange('2026-01-01', '2027-02-04')
  assert.equal(valid.endOrdinal - valid.startOrdinal + 1, MAX_LUNAR_DATE_RANGE_DAYS)

  assert.throws(
    () => validateLunarDateRange('2026-01-01', '2027-02-05'),
    (error: unknown) => error instanceof AppError && error.code === 'LUNAR_DATE_RANGE_TOO_LARGE',
  )
  assert.throws(
    () => validateLunarDateRange('2026-02-02', '2026-02-01'),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_LUNAR_DATE_RANGE',
  )
})

test('handles four-digit date-only ordinals without the JavaScript year 0-99 offset', () => {
  const start = dateOnlyToOrdinal(parseIsoDateOnly('0001-01-01', 'from'))
  const end = dateOnlyToOrdinal(parseIsoDateOnly('0001-01-02', 'to'))
  assert.equal(end - start, 1)
})

test('accepts the first and last supported years inclusively', () => {
  assert.doesNotThrow(() => validateLunarDateRange(
    `${LUNAR_SUPPORTED_MIN_YEAR}-01-01`,
    `${LUNAR_SUPPORTED_MIN_YEAR}-01-31`,
  ))
  assert.doesNotThrow(() => validateLunarDateRange(
    `${LUNAR_SUPPORTED_MAX_YEAR}-12-01`,
    `${LUNAR_SUPPORTED_MAX_YEAR}-12-31`,
  ))
})

test('rejects ranges outside the supported years with an informational code', () => {
  const outOfRangeRequests: ReadonlyArray<readonly [string, string]> = [
    [`${LUNAR_SUPPORTED_MIN_YEAR - 1}-12-31`, `${LUNAR_SUPPORTED_MIN_YEAR}-01-02`],
    [`${LUNAR_SUPPORTED_MAX_YEAR}-12-31`, `${LUNAR_SUPPORTED_MAX_YEAR + 1}-01-01`],
    ['2300-01-01', '2300-01-31'],
    ['0001-01-01', '0001-01-02'],
  ]

  for (const [from, to] of outOfRangeRequests) {
    assert.throws(
      () => validateLunarDateRange(from, to),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 422
        && error.code === 'LUNAR_DATE_OUT_OF_RANGE',
      `${from}..${to}`,
    )
  }
})

test('builds a complete inclusive range without skipping month boundaries', () => {
  const service = new LunarCalendarService()
  const dates = service.getDates('2026-02-16', '2026-02-18')
  assert.deepEqual(
    dates.map((date) => [date.solarDate, date.lunarDay, date.lunarMonth, date.lunarYear]),
    [
      ['2026-02-16', 29, 12, 2025],
      ['2026-02-17', 1, 1, 2026],
      ['2026-02-18', 2, 1, 2026],
    ],
  )
})

test('records Southern Vietnam alternate lunar date during 1968 Tet divergence', () => {
  const jan29 = vietnameseLunarAdapter.convert({ year: 1968, month: 1, day: 29 })
  assert.deepEqual(
    [jan29.lunarDay, jan29.lunarMonth, jan29.lunarYear],
    [1, 1, 1968],
  )
  assert.deepEqual(jan29.alternateLunar, {
    label: 'Miền Nam',
    lunarDay: 30,
    lunarMonth: 12,
    lunarYear: 1967,
    isLeapMonth: false,
  })
})

test('validates the preferences allowlist and rejects mass-assignment shapes', () => {
  assert.deepEqual(validateCalendarPreferencesInput({ showLunarCalendar: true }), { showLunarCalendar: true })
  assert.deepEqual(validateCalendarPreferencesInput({ showLunarCalendar: false }), { showLunarCalendar: false })
  assert.deepEqual(
    validateCalendarPreferencesInput({
      showVietnameseHolidays: false,
      showPublicHolidays: true,
      showObservanceHolidays: false,
    }),
    {
      showVietnameseHolidays: false,
      showPublicHolidays: true,
      showObservanceHolidays: false,
    },
  )
  assert.throws(
    () => validateCalendarPreferencesInput({}),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_CALENDAR_PREFERENCES',
  )
  assert.throws(
    () => validateCalendarPreferencesInput({ showLunarCalendar: true, role: 'admin' }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_CALENDAR_PREFERENCES',
  )
  assert.throws(
    () => validateCalendarPreferencesInput({ showLunarCalendar: 'true' }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_CALENDAR_PREFERENCES',
  )
})
