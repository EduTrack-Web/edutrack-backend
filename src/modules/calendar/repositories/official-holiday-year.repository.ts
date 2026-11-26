import { AppError } from '@/shared/errors/app-error.js'
import { OfficialHolidayYearModel } from '@/modules/calendar/models/official-holiday-year.model.js'
import type {
  OfficialHolidayEntry,
  OfficialHolidaySource,
  OfficialHolidayVersionSnapshot,
  OfficialHolidayYearRecord,
  OfficialHolidayYearStatus,
} from '@/modules/calendar/types/calendar.types.js'
import { validateOfficialHolidayYearInput } from '@/modules/calendar/validations/official-holiday.validation.js'

const MAX_PREVIOUS_VERSIONS = 5

export interface OfficialHolidayVersionMarker {
  year: number
  version: number
  updatedAt: string
}

export interface UpsertOfficialHolidayYearOptions {
  expectedVersion?: number
}

export interface OfficialHolidayYearRepository {
  findConfirmedByYears: (years: readonly number[]) => Promise<OfficialHolidayYearRecord[]>
  findVersionMarkers: (years: readonly number[]) => Promise<OfficialHolidayVersionMarker[]>
  upsertYear: (
    input: unknown,
    options?: UpsertOfficialHolidayYearOptions,
  ) => Promise<OfficialHolidayYearRecord>
  rollbackYearToVersion: (
    year: number,
    targetVersion: number,
    expectedCurrentVersion?: number,
  ) => Promise<OfficialHolidayYearRecord>
}

const toIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return new Date(0).toISOString()
}

const mapSource = (raw: unknown): OfficialHolidaySource => {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    name: typeof rec.name === 'string' ? rec.name : '',
    ...(typeof rec.referenceUrl === 'string' && rec.referenceUrl ? { referenceUrl: rec.referenceUrl } : {}),
    ...(typeof rec.verifiedBy === 'string' && rec.verifiedBy ? { verifiedBy: rec.verifiedBy } : {}),
    ...(rec.verifiedAt ? { verifiedAt: toIsoString(rec.verifiedAt) } : {}),
  }
}

const mapEntry = (raw: unknown): OfficialHolidayEntry => {
  const rec = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    key: String(rec.key ?? ''),
    solarDate: String(rec.solarDate ?? ''),
    name: String(rec.name ?? ''),
    calendarType: (rec.calendarType as OfficialHolidayEntry['calendarType']) ?? 'solar',
    isDayOff: Boolean(rec.isDayOff),
    ...(typeof rec.replacesRuleKey === 'string' && rec.replacesRuleKey
      ? { replacesRuleKey: rec.replacesRuleKey }
      : {}),
    ...(typeof rec.lunarDateLabel === 'string' && rec.lunarDateLabel
      ? { lunarDateLabel: rec.lunarDateLabel }
      : {}),
    ...(typeof rec.notes === 'string' && rec.notes ? { notes: rec.notes } : {}),
  }
}

const mapDocumentToRecord = (doc: unknown): OfficialHolidayYearRecord => {
  const rec = doc as Record<string, unknown>
  const rawPrev = Array.isArray(rec.previousVersions) ? rec.previousVersions : []
  const previousVersions: OfficialHolidayVersionSnapshot[] = rawPrev.map((snap) => {
    const s = snap as Record<string, unknown>
    return {
      version: Number(s.version ?? 1),
      status: (s.status as OfficialHolidayYearStatus) ?? 'archived',
      source: mapSource(s.source),
      holidays: Array.isArray(s.holidays) ? s.holidays.map(mapEntry) : [],
      archivedAt: toIsoString(s.archivedAt),
    }
  })

  return {
    year: Number(rec.year),
    status: (rec.status as OfficialHolidayYearStatus) ?? 'draft',
    source: mapSource(rec.source),
    version: Number(rec.version ?? 1),
    holidays: Array.isArray(rec.holidays) ? rec.holidays.map(mapEntry) : [],
    previousVersions,
    updatedAt: toIsoString(rec.updatedAt),
  }
}

export const officialHolidayYearRepository: OfficialHolidayYearRepository = {
  async findConfirmedByYears(years) {
    if (years.length === 0) return []
    const docs = await OfficialHolidayYearModel.find({
      year: { $in: [...years] },
      status: 'confirmed',
    }).lean()
    return docs.map(mapDocumentToRecord)
  },

  async findVersionMarkers(years) {
    if (years.length === 0) return []
    const docs = await OfficialHolidayYearModel.find({
      year: { $in: [...years] },
      status: 'confirmed',
    })
      .select('year version updatedAt')
      .lean()

    return docs.map((doc) => ({
      year: Number(doc.year),
      version: Number(doc.version),
      updatedAt: toIsoString(doc.updatedAt),
    }))
  },

  async upsertYear(input, options = {}) {
    const validated = validateOfficialHolidayYearInput(input)
    const existing = await OfficialHolidayYearModel.findOne({ year: validated.year }).lean()

    if (!existing) {
      if (options.expectedVersion !== undefined && options.expectedVersion !== 0) {
        throw new AppError(
          409,
          'HOLIDAY_VERSION_CONFLICT',
          `Không tìm thấy bản ghi năm ${validated.year} với version ${options.expectedVersion}.`,
        )
      }

      try {
        const created = await OfficialHolidayYearModel.create({
          year: validated.year,
          status: validated.status,
          source: {
            ...validated.source,
            ...(validated.source.verifiedAt ? { verifiedAt: new Date(validated.source.verifiedAt) } : {}),
          },
          version: 1,
          holidays: validated.holidays,
          previousVersions: [],
        })
        return mapDocumentToRecord(created.toObject())
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
          throw new AppError(
            409,
            'HOLIDAY_VERSION_CONFLICT',
            `Bản ghi năm ${validated.year} đã được tạo đồng thời bởi tiến trình khác.`,
          )
        }
        throw error
      }
    }

    const currentVersion = Number(existing.version)
    if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      throw new AppError(
        409,
        'HOLIDAY_VERSION_CONFLICT',
        `Xung đột version năm ${validated.year}: kỳ vọng ${options.expectedVersion}, hiện tại ${currentVersion}.`,
      )
    }

    const previousSnapshot = {
      version: currentVersion,
      status: existing.status,
      source: existing.source,
      holidays: existing.holidays,
      archivedAt: new Date(),
    }
    const existingPrevious = Array.isArray(existing.previousVersions) ? existing.previousVersions : []
    const nextPreviousVersions = [...existingPrevious, previousSnapshot].slice(-MAX_PREVIOUS_VERSIONS)

    const updated = await OfficialHolidayYearModel.findOneAndUpdate(
      { year: validated.year, version: currentVersion },
      {
        $set: {
          status: validated.status,
          source: {
            ...validated.source,
            ...(validated.source.verifiedAt ? { verifiedAt: new Date(validated.source.verifiedAt) } : {}),
          },
          holidays: validated.holidays,
          previousVersions: nextPreviousVersions,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean()

    if (!updated) {
      throw new AppError(
        409,
        'HOLIDAY_VERSION_CONFLICT',
        `Bản ghi năm ${validated.year} vừa được cập nhật bởi tiến trình khác. Vui lòng tải lại và thử lại.`,
      )
    }

    return mapDocumentToRecord(updated)
  },

  async rollbackYearToVersion(year, targetVersion, expectedCurrentVersion) {
    const existing = await OfficialHolidayYearModel.findOne({ year }).lean()
    if (!existing) {
      throw new AppError(404, 'OFFICIAL_HOLIDAY_YEAR_NOT_FOUND', `Không tìm thấy dữ liệu ngày lễ cho năm ${year}.`)
    }

    const currentVersion = Number(existing.version)
    if (expectedCurrentVersion !== undefined && expectedCurrentVersion !== currentVersion) {
      throw new AppError(
        409,
        'HOLIDAY_VERSION_CONFLICT',
        `Xung đột version năm ${year}: kỳ vọng ${expectedCurrentVersion}, hiện tại ${currentVersion}.`,
      )
    }

    const previousList = Array.isArray(existing.previousVersions) ? existing.previousVersions : []
    const targetSnapshot = previousList.find((snap) => Number(snap.version) === targetVersion)
    if (!targetSnapshot) {
      throw new AppError(
        404,
        'OFFICIAL_HOLIDAY_VERSION_NOT_FOUND',
        `Không tìm thấy version ${targetVersion} trong lịch sử năm ${year}.`,
      )
    }

    const snapshotOfCurrent = {
      version: currentVersion,
      status: existing.status,
      source: existing.source,
      holidays: existing.holidays,
      archivedAt: new Date(),
    }
    const nextPreviousVersions = [...previousList, snapshotOfCurrent].slice(-MAX_PREVIOUS_VERSIONS)

    const updated = await OfficialHolidayYearModel.findOneAndUpdate(
      { year, version: currentVersion },
      {
        $set: {
          status: targetSnapshot.status === 'archived' ? 'confirmed' : targetSnapshot.status,
          source: targetSnapshot.source,
          holidays: targetSnapshot.holidays,
          previousVersions: nextPreviousVersions,
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after', runValidators: true },
    ).lean()

    if (!updated) {
      throw new AppError(
        409,
        'HOLIDAY_VERSION_CONFLICT',
        `Xung đột khi rollback năm ${year}. Vui lòng thử lại.`,
      )
    }

    return mapDocumentToRecord(updated)
  },
}
