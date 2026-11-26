import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { AppError } from '@/shared/errors/app-error.js'
import { OfficialHolidayYearModel } from '@/modules/calendar/models/official-holiday-year.model.js'
import type {
  OfficialHolidayVersionMarker,
  OfficialHolidayYearRepository,
  UpsertOfficialHolidayYearOptions,
} from '@/modules/calendar/repositories/official-holiday-year.repository.js'
import { VietnameseHolidaysService } from '@/modules/calendar/services/vietnamese-holidays.service.js'
import { vietnameseLunarAdapter } from '@/modules/calendar/services/vietnamese-lunar.adapter.js'
import type { OfficialHolidayYearRecord } from '@/modules/calendar/types/calendar.types.js'
import { validateOfficialHolidayYearInput } from '@/modules/calendar/validations/official-holiday.validation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../../src/modules/calendar/data/official-holidays')

class InMemoryOfficialHolidayRepository implements OfficialHolidayYearRepository {
  private readonly store = new Map<number, OfficialHolidayYearRecord>()
  public markerCalls = 0
  public fullFetchCalls = 0
  public simulatedLatencyMs = 0
  public failReads = false

  public async seedFromJsonFiles(years: readonly number[]): Promise<void> {
    for (const year of years) {
      const raw = await readFile(path.join(DATA_DIR, `${year}.json`), 'utf8')
      await this.upsertYear(JSON.parse(raw))
    }
  }

  public async findVersionMarkers(years: readonly number[]): Promise<OfficialHolidayVersionMarker[]> {
    this.markerCalls += 1
    if (this.simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedLatencyMs))
    }
    if (this.failReads) throw new Error('MongoDB connection refused')

    const markers: OfficialHolidayVersionMarker[] = []
    for (const year of years) {
      const rec = this.store.get(year)
      if (rec && rec.status === 'confirmed') {
        markers.push({ year: rec.year, version: rec.version, updatedAt: rec.updatedAt })
      }
    }
    return markers
  }

  public async findConfirmedByYears(years: readonly number[]): Promise<OfficialHolidayYearRecord[]> {
    this.fullFetchCalls += 1
    if (this.failReads) throw new Error('MongoDB connection refused')

    const records: OfficialHolidayYearRecord[] = []
    for (const year of years) {
      const rec = this.store.get(year)
      if (rec && rec.status === 'confirmed') {
        records.push(structuredClone(rec))
      }
    }
    return records
  }

  public async upsertYear(
    input: unknown,
    options: UpsertOfficialHolidayYearOptions = {},
  ): Promise<OfficialHolidayYearRecord> {
    const validated = validateOfficialHolidayYearInput(input)
    const existing = this.store.get(validated.year)

    if (!existing) {
      if (options.expectedVersion !== undefined && options.expectedVersion !== 0) {
        throw new AppError(409, 'HOLIDAY_VERSION_CONFLICT', 'Version conflict on create')
      }
      const created: OfficialHolidayYearRecord = {
        year: validated.year,
        status: validated.status,
        source: validated.source,
        version: 1,
        holidays: validated.holidays,
        previousVersions: [],
        updatedAt: new Date().toISOString(),
      }
      this.store.set(validated.year, structuredClone(created))
      return created
    }

    if (options.expectedVersion !== undefined && options.expectedVersion !== existing.version) {
      throw new AppError(409, 'HOLIDAY_VERSION_CONFLICT', 'Version conflict on update')
    }

    const updated: OfficialHolidayYearRecord = {
      year: validated.year,
      status: validated.status,
      source: validated.source,
      version: existing.version + 1,
      holidays: validated.holidays,
      previousVersions: [
        ...existing.previousVersions,
        {
          version: existing.version,
          status: existing.status,
          source: existing.source,
          holidays: existing.holidays,
          archivedAt: new Date().toISOString(),
        },
      ].slice(-5),
      updatedAt: new Date().toISOString(),
    }
    this.store.set(validated.year, structuredClone(updated))
    return updated
  }

  public async rollbackYearToVersion(
    year: number,
    targetVersion: number,
    expectedCurrentVersion?: number,
  ): Promise<OfficialHolidayYearRecord> {
    const existing = this.store.get(year)
    if (!existing) throw new AppError(404, 'OFFICIAL_HOLIDAY_YEAR_NOT_FOUND', 'Year not found')
    if (expectedCurrentVersion !== undefined && expectedCurrentVersion !== existing.version) {
      throw new AppError(409, 'HOLIDAY_VERSION_CONFLICT', 'Version conflict on rollback')
    }
    const target = existing.previousVersions.find((snap) => snap.version === targetVersion)
    if (!target) throw new AppError(404, 'OFFICIAL_HOLIDAY_VERSION_NOT_FOUND', 'Version not found')

    const rolledBack: OfficialHolidayYearRecord = {
      year,
      status: target.status === 'archived' ? 'confirmed' : target.status,
      source: target.source,
      version: existing.version + 1,
      holidays: target.holidays,
      previousVersions: [
        ...existing.previousVersions,
        {
          version: existing.version,
          status: existing.status,
          source: existing.source,
          holidays: existing.holidays,
          archivedAt: new Date().toISOString(),
        },
      ].slice(-5),
      updatedAt: new Date().toISOString(),
    }
    this.store.set(year, structuredClone(rolledBack))
    return rolledBack
  }
}

test('returns 2026 confirmed solar, lunar, swap, compensatory, and Culture Day holidays without duplicating Group A', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  await repo.seedFromJsonFiles([2026])
  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)

  const holidays = await service.getHolidays('2026-01-01', '2026-12-31')
  const byDateAndName = new Map(holidays.map((item) => [`${item.solarDate}:${item.name}`, item]))

  assert.equal(byDateAndName.get('2026-01-01:Tết Dương lịch')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-01-02:Tết Dương lịch (Ngày hoán đổi)')?.calendarType, 'compensatory')
  assert.equal(byDateAndName.get('2026-02-17:Mùng 1 Tết Nguyên Đán')?.category, 'public_holiday')
  assert.equal(
    holidays.filter((h) => h.solarDate === '2026-02-17' && h.name === 'Mùng 1 Tết Nguyên Đán').length,
    1,
    'Group A and Group B tet_1 must deduplicate into a single entry',
  )
  assert.equal(byDateAndName.get('2026-04-26:Giỗ Tổ Hùng Vương')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-04-27:Giỗ Tổ Hùng Vương (Nghỉ bù)')?.calendarType, 'compensatory')
  assert.equal(byDateAndName.get('2026-07-27:Ngày Thương binh - Liệt sĩ')?.isDayOff, false)
  assert.equal(byDateAndName.get('2026-08-31:Ngày Quốc khánh (Ngày hoán đổi)')?.calendarType, 'compensatory')
  assert.equal(byDateAndName.get('2026-09-01:Ngày Quốc khánh (Nghỉ liền kề)')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-09-02:Ngày Quốc khánh')?.category, 'public_holiday')
  assert.equal(byDateAndName.get('2026-11-24:Ngày Văn hóa Việt Nam')?.isDayOff, true)
  assert.equal(byDateAndName.get('2026-09-25:Tết Trung thu')?.lunarDateLabel, '15/8 Âm lịch')
  assert.equal(byDateAndName.get('2026-09-25:Tết Trung thu')?.lunarDate?.yearCanChi, 'Bính Ngọ')
  assert.equal(byDateAndName.get('2026-01-01:Tết Dương lịch')?.lunarDate?.yearCanChi, 'Ất Tỵ')
})

test('preserves Group A observances even when overlapping a Group B day off', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  await repo.upsertYear({
    year: 2029,
    status: 'confirmed',
    source: { name: 'Official Decree 2029', verifiedBy: 'Reviewer' },
    holidays: [
      { key: 'tet_2', solarDate: '2029-02-14', name: 'Mùng 2 Tết Nguyên Đán', calendarType: 'lunar', isDayOff: true },
    ],
  })
  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)
  const feb14Items = (await service.getHolidays('2029-02-14', '2029-02-14'))
    .map((item) => item.name)
    .sort()

  assert.deepEqual(feb14Items, ['Lễ Tình nhân', 'Mùng 2 Tết Nguyên Đán'])
})

test('does not guess compensatory, swap, or extended Tet holidays for unconfirmed years while keeping core Tet 1-3', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)

  const holidays2028 = await service.getHolidays('2028-01-01', '2028-11-30')
  const tetDays = holidays2028.filter((h) => h.name.includes('Tết Nguyên Đán'))
  assert.deepEqual(
    tetDays.map((h) => h.solarDate),
    ['2028-01-26', '2028-01-27', '2028-01-28'],
    'Core Tet Mung 1-3 must remain visible without guessing Mung 4-5 or 28-30 Tet',
  )
  assert.equal(
    holidays2028.find((h) => h.calendarType === 'compensatory'),
    undefined,
    'Must not auto-guess compensatory days off without confirmed official decree',
  )
})

test('handles 1000 concurrent requests with in-flight deduplication and 1000 staggered requests via L1 cache', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  await repo.seedFromJsonFiles([2027])
  repo.simulatedLatencyMs = 15

  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo, { cacheTtlMs: 60_000 })
  const concurrentResults = await Promise.all(
    Array.from({ length: 1_000 }, () => service.getHolidays('2027-01-01', '2027-12-31')),
  )

  assert.equal(repo.markerCalls, 1, '1000 concurrent requests must collapse into 1 DB marker check')
  assert.equal(repo.fullFetchCalls, 1, '1000 concurrent requests must collapse into 1 DB full fetch')
  assert.equal(concurrentResults[0]?.length, concurrentResults[999]?.length)

  for (let index = 0; index < 1_000; index += 1) {
    await service.getHolidays('2027-01-01', '2027-12-31')
  }
  assert.equal(repo.markerCalls, 1, 'Staggered requests within TTL must be served from L1 RAM cache')
})

test('persists official data across simulated backend restart and survives external fetch outage', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  await repo.seedFromJsonFiles([2025])

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('External CDN unreachable')
  }) as typeof fetch

  try {
    const instanceBeforeRestart = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)
    const first = await instanceBeforeRestart.getHolidays('2025-01-25', '2025-09-05')

    const instanceAfterRestart = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)
    const second = await instanceAfterRestart.getHolidays('2025-01-25', '2025-09-05')

    assert.deepEqual(first, second)
    assert.ok(second.some((h) => h.solarDate === '2025-05-02' && h.calendarType === 'compensatory'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('degrades gracefully to Group A rule-based holidays when MongoDB is unavailable', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  repo.failReads = true
  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)

  const originalWarn = console.warn
  console.warn = () => {}
  try {
    const holidays = await service.getHolidays('2026-01-01', '2026-12-31')
    assert.ok(holidays.some((h) => h.solarDate === '2026-02-17' && h.name === 'Mùng 1 Tết Nguyên Đán'))
    assert.ok(holidays.some((h) => h.solarDate === '2026-09-02' && h.name === 'Ngày Quốc khánh'))
  } finally {
    console.warn = originalWarn
  }
})

test('supports version updates, cache invalidation, rollback, and multi-instance optimistic locking', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  let now = 1_000
  const serviceInstanceA = new VietnameseHolidaysService(vietnameseLunarAdapter, repo, {
    cacheTtlMs: 500,
    nowProvider: () => now,
  })
  const serviceInstanceB = new VietnameseHolidaysService(vietnameseLunarAdapter, repo, {
    cacheTtlMs: 500,
    nowProvider: () => now,
  })

  const v1 = await repo.upsertYear({
    year: 2028,
    status: 'confirmed',
    source: { name: 'Decree v1', verifiedBy: 'Admin' },
    holidays: [
      { key: 'tet_4', solarDate: '2028-01-29', name: 'Tết Nguyên Đán (Mùng 4)', calendarType: 'lunar', isDayOff: true },
    ],
  })
  assert.equal(v1.version, 1)

  assert.ok((await serviceInstanceA.getHolidays('2028-01-29', '2028-01-29')).some((h) => h.name === 'Tết Nguyên Đán (Mùng 4)'))
  assert.ok((await serviceInstanceB.getHolidays('2028-01-29', '2028-01-29')).some((h) => h.name === 'Tết Nguyên Đán (Mùng 4)'))

  // Two instances racing on expectedVersion=1 -> one succeeds, one gets 409 conflict
  const v2 = await repo.upsertYear(
    {
      year: 2028,
      status: 'confirmed',
      source: { name: 'Decree v2', verifiedBy: 'Admin' },
      holidays: [
        { key: 'tet_4', solarDate: '2028-01-29', name: 'Tết Nguyên Đán (Mùng 4)', calendarType: 'lunar', isDayOff: true },
        { key: 'tet_5', solarDate: '2028-01-30', name: 'Tết Nguyên Đán (Mùng 5)', calendarType: 'lunar', isDayOff: true },
      ],
    },
    { expectedVersion: 1 },
  )
  assert.equal(v2.version, 2)

  await assert.rejects(
    () =>
      repo.upsertYear(
        {
          year: 2028,
          status: 'confirmed',
          source: { name: 'Stale writer', verifiedBy: 'Admin' },
          holidays: [],
        },
        { expectedVersion: 1 },
      ),
    (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === 'HOLIDAY_VERSION_CONFLICT',
  )

  // Advance clock past TTL -> both instances see v2
  now += 1_000
  assert.ok((await serviceInstanceB.getHolidays('2028-01-30', '2028-01-30')).some((h) => h.name === 'Tết Nguyên Đán (Mùng 5)'))

  // Rollback v2 -> v1 creates v3 with v1 holidays
  const rolledBack = await repo.rollbackYearToVersion(2028, 1, 2)
  assert.equal(rolledBack.version, 3)

  now += 1_000
  const afterRollback = await serviceInstanceA.getHolidays('2028-01-30', '2028-01-30')
  assert.equal(afterRollback.some((h) => h.name === 'Tết Nguyên Đán (Mùng 5)'), false)
})

test('produces identical holiday dates regardless of server TZ environment variable', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  await repo.seedFromJsonFiles([2026])
  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)
  const originalTz = process.env.TZ

  try {
    process.env.TZ = 'America/Los_Angeles'
    const usItems = await service.getHolidays('2026-01-01', '2026-12-31')
    service.clearCache()

    process.env.TZ = 'Asia/Ho_Chi_Minh'
    const vnItems = await service.getHolidays('2026-01-01', '2026-12-31')

    assert.deepEqual(usItems, vnItems)
  } finally {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  }
})

test('validates official holiday year input strictly and blocks unverified confirmed records', () => {
  assert.throws(
    () =>
      validateOfficialHolidayYearInput({
        year: 2028,
        status: 'confirmed',
        source: { name: 'Unverified' },
        holidays: [
          { key: 'bad-key', solarDate: '2029-01-01', name: '', calendarType: 'invalid', isDayOff: 'yes' },
        ],
      }),
    (error: unknown) =>
      error instanceof AppError
      && error.code === 'INVALID_OFFICIAL_HOLIDAY_YEAR'
      && Boolean(error.fieldErrors?.['source.verifiedBy'])
      && Boolean(error.fieldErrors?.['holidays.0.key'])
      && Boolean(error.fieldErrors?.['holidays.0.solarDate'])
      && Boolean(error.fieldErrors?.['holidays.0.name'])
      && Boolean(error.fieldErrors?.['holidays.0.calendarType'])
      && Boolean(error.fieldErrors?.['holidays.0.isDayOff']),
  )
})

test('rejects invalid or oversized date ranges for holidays', async () => {
  const repo = new InMemoryOfficialHolidayRepository()
  const service = new VietnameseHolidaysService(vietnameseLunarAdapter, repo)

  await assert.rejects(
    () => service.getHolidays('2026-05-01', '2026-04-01'),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_LUNAR_DATE_RANGE',
  )
  await assert.rejects(
    () => service.getHolidays('2026-01-01', '2027-02-05'),
    (error: unknown) => error instanceof AppError && error.code === 'LUNAR_DATE_RANGE_TOO_LARGE',
  )
})

test('validates all official JSON seed files against Mongoose OfficialHolidayYearModel schema', async () => {
  for (const year of [2024, 2025, 2026, 2027]) {
    const raw = await readFile(path.join(DATA_DIR, `${year}.json`), 'utf8')
    const validated = validateOfficialHolidayYearInput(JSON.parse(raw))
    const doc = new OfficialHolidayYearModel({
      ...validated,
      version: 1,
      previousVersions: [],
    })
    const schemaError = doc.validateSync()
    assert.equal(schemaError, undefined, `Schema validation failed for ${year}.json`)
  }
})
