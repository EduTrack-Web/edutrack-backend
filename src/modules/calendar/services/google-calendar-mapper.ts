import type {
  EventAvailability,
  EventVisibility,
  GoogleCalendarAccessRole,
  RecurrenceConfig,
  RecurrenceFrequency,
} from '@/modules/calendar/types/calendar.types.js'
import {
  GOOGLE_EVENT_COLOR_PALETTE,
  type GoogleCalendarEventResource,
  type GoogleEventUpsertPayload,
} from '@/modules/calendar/services/google-calendar.adapter.js'

export const DEFAULT_SYNC_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

const normalizeTimeZone = (value?: string): string => {
  if (!value) return DEFAULT_SYNC_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return value
  } catch {
    return DEFAULT_SYNC_TIME_ZONE
  }
}

const formatIsoDateInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

const addDaysToIsoDate = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  const year = utc.getUTCFullYear()
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const day = String(utc.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseTimeZoneOffsetMs = (date: Date, timeZone: string): number => {
  const tz = normalizeTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const hour = get('hour') === 24 ? 0 : get('hour')
  const zonedUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return zonedUtc - date.getTime()
}

const zonedDateTimeToUtc = (isoDate: string, timeStr: string, timeZone: string): Date => {
  const [y, m, d] = isoDate.split('-').map(Number)
  const [hh, mm, ss] = timeStr.split(':').map(Number)
  const roughUtc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, ss ?? 0))
  const offsetMs = parseTimeZoneOffsetMs(roughUtc, timeZone)
  return new Date(roughUtc.getTime() - offsetMs)
}

const formatUtcCompactTimestamp = (date: Date): string => {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}${m}${d}T${hh}${mm}${ss}Z`
}

const parseRfcDateToken = (token: string, fallbackTimeZone: string): Date | null => {
  const clean = token.trim()
  const dateOnlyMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch
    return zonedDateTimeToUtc(`${y}-${m}-${d}`, '00:00:00', fallbackTimeZone)
  }
  const dateTimeMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (dateTimeMatch) {
    const [, y, m, d, hh, mm, ss, z] = dateTimeMatch
    if (z === 'Z') {
      return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
    }
    return zonedDateTimeToUtc(`${y}-${m}-${d}`, `${hh}:${mm}:${ss}`, fallbackTimeZone)
  }
  return null
}

export const toGoogleRecurrence = (
  recurrence?: RecurrenceConfig | null,
  exceptionDates?: readonly Date[],
  isAllDay = false,
  timeZone = DEFAULT_SYNC_TIME_ZONE,
): string[] | undefined => {
  if (!recurrence || recurrence.frequency === 'none') return undefined

  const interval = Math.max(1, recurrence.interval || 1)
  let rrule = ''

  switch (recurrence.frequency) {
    case 'daily':
      rrule = `RRULE:FREQ=DAILY;INTERVAL=${interval}`
      break
    case 'weekly':
      rrule = `RRULE:FREQ=WEEKLY;INTERVAL=${interval}`
      break
    case 'weekdays':
      rrule = 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
      break
    case 'monthly':
      rrule = `RRULE:FREQ=MONTHLY;INTERVAL=${interval}`
      break
    case 'yearly':
      rrule = `RRULE:FREQ=YEARLY;INTERVAL=${interval}`
      break
    case 'custom': {
      const days = (recurrence.daysOfWeek ?? [])
        .map((day) => WEEKDAY_CODES[day])
        .filter((code): code is (typeof WEEKDAY_CODES)[number] => Boolean(code))
      rrule = days.length > 0
        ? `RRULE:FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${days.join(',')}`
        : `RRULE:FREQ=WEEKLY;INTERVAL=${interval}`
      break
    }
    default:
      return undefined
  }

  if (recurrence.count && recurrence.count > 0) {
    rrule += `;COUNT=${recurrence.count}`
  } else if (recurrence.until) {
    const untilDate = new Date(recurrence.until)
    if (!Number.isNaN(untilDate.getTime())) {
      rrule += `;UNTIL=${formatUtcCompactTimestamp(untilDate)}`
    }
  }

  const lines = [rrule]
  if (exceptionDates && exceptionDates.length > 0) {
    const validExdates = exceptionDates
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()))
    if (validExdates.length > 0) {
      if (isAllDay) {
        const tokens = validExdates.map((d) => formatIsoDateInTimeZone(d, timeZone).replaceAll('-', ''))
        lines.push(`EXDATE;VALUE=DATE:${tokens.join(',')}`)
      } else {
        const tokens = validExdates.map((d) => formatUtcCompactTimestamp(d))
        lines.push(`EXDATE:${tokens.join(',')}`)
      }
    }
  }

  return lines
}

export const fromGoogleRecurrenceWithExceptions = (
  rules?: readonly string[],
  timeZone = DEFAULT_SYNC_TIME_ZONE,
): { recurrence: RecurrenceConfig; exceptionDates: Date[] } => {
  const defaultConfig: RecurrenceConfig = { frequency: 'none', interval: 1, daysOfWeek: [], until: null, count: null }
  if (!rules || rules.length === 0) return { recurrence: defaultConfig, exceptionDates: [] }

  const exceptionDates: Date[] = []
  for (const line of rules) {
    const upper = line.toUpperCase()
    if (upper.startsWith('EXDATE')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx >= 0) {
        const rawList = line.slice(colonIdx + 1).split(',')
        for (const item of rawList) {
          const parsed = parseRfcDateToken(item, timeZone)
          if (parsed) exceptionDates.push(parsed)
        }
      }
    }
  }

  const rruleLine = rules.find((line) => line.toUpperCase().startsWith('RRULE:'))
  if (!rruleLine) return { recurrence: defaultConfig, exceptionDates }

  const rawParts = rruleLine.slice(6).split(';')
  const map = new Map<string, string>()
  for (const part of rawParts) {
    const eqIdx = part.indexOf('=')
    if (eqIdx > 0) {
      map.set(part.slice(0, eqIdx).toUpperCase(), part.slice(eqIdx + 1).toUpperCase())
    }
  }

  const freq = map.get('FREQ')
  const intervalRaw = Number(map.get('INTERVAL') ?? '1')
  const interval = Number.isInteger(intervalRaw) && intervalRaw >= 1 ? Math.min(intervalRaw, 99) : 1
  const countRaw = map.get('COUNT') ? Number(map.get('COUNT')) : null
  const count = countRaw && Number.isInteger(countRaw) && countRaw >= 1 ? Math.min(countRaw, 365) : null

  let until: string | null = null
  const untilRaw = map.get('UNTIL')
  if (untilRaw) {
    const parsedUntil = parseRfcDateToken(untilRaw, timeZone)
    if (parsedUntil) until = parsedUntil.toISOString()
  }

  const byDay = map.get('BYDAY')?.split(',').filter(Boolean) ?? []
  const mappedDays = byDay
    .map((code) => WEEKDAY_CODES.indexOf(code.slice(-2) as (typeof WEEKDAY_CODES)[number]))
    .filter((idx) => idx >= 0)

  let frequency: RecurrenceFrequency = 'none'
  if (freq === 'DAILY') frequency = 'daily'
  else if (freq === 'MONTHLY') frequency = 'monthly'
  else if (freq === 'YEARLY') frequency = 'yearly'
  else if (freq === 'WEEKLY') {
    const weekdaySorted = [...mappedDays].sort((a, b) => a - b).join(',')
    if (weekdaySorted === '1,2,3,4,5' && interval === 1) {
      frequency = 'weekdays'
    } else if (mappedDays.length > 0) {
      frequency = 'custom'
    } else {
      frequency = 'weekly'
    }
  }

  if (frequency === 'none') return { recurrence: defaultConfig, exceptionDates }
  return {
    recurrence: {
      frequency,
      interval,
      daysOfWeek: mappedDays,
      until,
      count,
    },
    exceptionDates,
  }
}

export const fromGoogleRecurrence = (rules?: readonly string[]): RecurrenceConfig =>
  fromGoogleRecurrenceWithExceptions(rules).recurrence

export const parseGoogleOriginalStartTime = (
  resource: GoogleCalendarEventResource,
  fallbackTimeZone = DEFAULT_SYNC_TIME_ZONE,
): Date | null => {
  const ost = resource.originalStartTime
  if (!ost) return null
  const tz = normalizeTimeZone(ost.timeZone || fallbackTimeZone)
  if (ost.date && !ost.dateTime) {
    return zonedDateTimeToUtc(ost.date, '00:00:00', tz)
  }
  if (ost.dateTime) {
    const parsed = new Date(ost.dateTime)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

export const isGoogleEventEditable = (params: {
  accessRole: GoogleCalendarAccessRole
  resource: GoogleCalendarEventResource
  accountEmail: string
}): boolean => {
  if (params.accessRole === 'freeBusyReader' || params.accessRole === 'reader') {
    return false
  }
  if (params.resource.locked === true) {
    return false
  }
  const organizerEmail = params.resource.organizer?.email?.trim().toLowerCase()
  const cleanAccountEmail = params.accountEmail.trim().toLowerCase()
  if (
    params.resource.organizer?.self === false &&
    organizerEmail &&
    organizerEmail !== cleanAccountEmail &&
    params.resource.guestsCanModify !== true
  ) {
    return false
  }
  return true
}

const parseHexRgb = (hex: string): [number, number, number] | null => {
  const cleaned = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    const r = Number.parseInt(cleaned[0]! + cleaned[0]!, 16)
    const g = Number.parseInt(cleaned[1]! + cleaned[1]!, 16)
    const b = Number.parseInt(cleaned[2]! + cleaned[2]!, 16)
    return [r, g, b]
  }
  if (/^[0-9a-f]{6}$/i.test(cleaned)) {
    const r = Number.parseInt(cleaned.slice(0, 2), 16)
    const g = Number.parseInt(cleaned.slice(2, 4), 16)
    const b = Number.parseInt(cleaned.slice(4, 6), 16)
    return [r, g, b]
  }
  return null
}

export const findClosestGoogleEventColorId = (
  hex: string,
  palette: Readonly<Record<string, string>> = GOOGLE_EVENT_COLOR_PALETTE,
): string => {
  const targetRgb = parseHexRgb(hex)
  if (!targetRgb) return ''

  const normalizedHex = hex.trim().toLowerCase()
  const entries = Object.entries(palette)
  const exactMatch = entries.find(([, value]) => value.trim().toLowerCase() === normalizedHex)
  if (exactMatch) {
    return exactMatch[0]
  }

  let bestId = ''
  let bestDistanceSq = Number.POSITIVE_INFINITY
  for (const [colorId, paletteHex] of entries) {
    const rgb = parseHexRgb(paletteHex)
    if (!rgb) continue
    const rMean = (targetRgb[0] + rgb[0]) / 2
    const dr = targetRgb[0] - rgb[0]
    const dg = targetRgb[1] - rgb[1]
    const db = targetRgb[2] - rgb[2]
    const distanceSq =
      (2 + rMean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rMean) / 256) * db * db
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq
      bestId = colorId
    }
  }
  return bestId
}

export interface LocalSyncableEventFields {
  title: string
  description?: string
  startDate: Date
  endDate: Date
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  color?: string
  isGoogleLinked?: boolean
  skipColorPatch?: boolean
  colorPalette?: Readonly<Record<string, string>>
  availability?: EventAvailability
  visibility?: EventVisibility
  timeZone?: string
  recurrence?: {
    frequency: RecurrenceFrequency
    interval: number
    daysOfWeek?: number[]
    until?: Date | null
    count?: number | null
  } | null
  exceptionDates?: readonly Date[]
}

export const localEventToGooglePayload = (event: LocalSyncableEventFields): GoogleEventUpsertPayload => {
  const timeZone = normalizeTimeZone(event.timeZone)
  const isAllDay = Boolean(event.isAllDay)

  let start: GoogleEventUpsertPayload['start']
  let end: GoogleEventUpsertPayload['end']

  if (isAllDay) {
    const startIso = formatIsoDateInTimeZone(event.startDate, timeZone)
    const inclusiveEndIso = formatIsoDateInTimeZone(event.endDate, timeZone)
    const safeEndIso = inclusiveEndIso < startIso ? startIso : inclusiveEndIso
    start = { date: startIso }
    end = { date: addDaysToIsoDate(safeEndIso, 1) }
  } else {
    start = { dateTime: event.startDate.toISOString(), timeZone }
    const safeEnd = event.endDate.getTime() > event.startDate.getTime()
      ? event.endDate
      : new Date(event.startDate.getTime() + 60 * 60 * 1000)
    end = { dateTime: safeEnd.toISOString(), timeZone }
  }

  const recurrence = toGoogleRecurrence(
    event.recurrence
      ? {
        frequency: event.recurrence.frequency,
        interval: event.recurrence.interval,
        daysOfWeek: event.recurrence.daysOfWeek ?? [],
        until: event.recurrence.until ? event.recurrence.until.toISOString() : null,
        count: event.recurrence.count ?? null,
      }
      : null,
    event.exceptionDates,
    isAllDay,
    timeZone,
  )

  const trimmedColor = typeof event.color === 'string' ? event.color.trim() : ''
  let colorPatch: { colorId: string | null } | undefined
  if (!event.skipColorPatch) {
    if (trimmedColor) {
      const mappedColorId = findClosestGoogleEventColorId(trimmedColor, event.colorPalette)
      if (mappedColorId) {
        colorPatch = { colorId: mappedColorId }
      }
    } else if (event.isGoogleLinked) {
      colorPatch = { colorId: null }
    }
  }

  return {
    summary: (event.title || 'Không có tiêu đề').slice(0, 150),
    description: event.description ?? '',
    location: event.location ?? '',
    start,
    end,
    transparency: event.availability === 'free' ? 'transparent' : 'opaque',
    visibility: event.visibility ?? 'default',
    ...(colorPatch ?? {}),
    ...(recurrence ? { recurrence } : {}),
  }
}

export interface MappedGoogleEventFields {
  title: string
  description: string
  startDate: Date
  endDate: Date
  isAllDay: boolean
  location: string
  onlineMeetingUrl: string
  availability: EventAvailability
  visibility: EventVisibility
  timeZone: string
  eventColorId: string
  eventLabelId: string
  eventColor: string
  recurrence: {
    frequency: RecurrenceFrequency
    interval: number
    daysOfWeek: number[]
    until: Date | null
    count: number | null
  }
  exceptionDates: Date[]
  originalStartTime: Date | null
  etag: string
  updatedAt: Date
}

export const googleEventToLocalFields = (
  resource: GoogleCalendarEventResource,
  calendarTimeZone = DEFAULT_SYNC_TIME_ZONE,
  eventColorPalette: Readonly<Record<string, string>> = GOOGLE_EVENT_COLOR_PALETTE,
  eventLabelPalette?: Readonly<Record<string, string>>,
): MappedGoogleEventFields | null => {
  if (!resource.start) return null

  const timeZone = normalizeTimeZone(resource.start.timeZone || resource.end?.timeZone || calendarTimeZone)
  const isAllDay = Boolean(resource.start.date && !resource.start.dateTime)

  let startDate: Date
  let endDate: Date

  if (isAllDay && resource.start.date) {
    const startIso = resource.start.date
    const exclusiveEndIso = resource.end?.date ?? addDaysToIsoDate(startIso, 1)
    const inclusiveEndIso = addDaysToIsoDate(exclusiveEndIso, -1)
    const safeInclusiveEnd = inclusiveEndIso < startIso ? startIso : inclusiveEndIso
    startDate = zonedDateTimeToUtc(startIso, '00:00:00', timeZone)
    endDate = zonedDateTimeToUtc(safeInclusiveEnd, '23:59:59', timeZone)
  } else if (resource.start.dateTime) {
    startDate = new Date(resource.start.dateTime)
    if (Number.isNaN(startDate.getTime())) return null
    endDate = resource.end?.dateTime
      ? new Date(resource.end.dateTime)
      : new Date(startDate.getTime() + 60 * 60 * 1000)
    if (Number.isNaN(endDate.getTime()) || endDate.getTime() < startDate.getTime()) {
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
    }
  } else {
    return null
  }

  const { recurrence: rec, exceptionDates } = fromGoogleRecurrenceWithExceptions(resource.recurrence, timeZone)
  const updatedAt = resource.updated ? new Date(resource.updated) : new Date()
  const eventLabelId = resource.eventLabelId?.trim() ?? ''
  const eventColorId = resource.colorId?.trim() ?? ''
  let eventColor = ''
  if (eventLabelId) {
    eventColor =
      eventLabelPalette?.[eventLabelId] ??
      eventColorPalette[eventLabelId] ??
      GOOGLE_EVENT_COLOR_PALETTE[eventLabelId] ??
      ''
  }
  if (!eventColor && eventColorId) {
    eventColor = eventColorPalette[eventColorId] ?? GOOGLE_EVENT_COLOR_PALETTE[eventColorId] ?? ''
  }

  return {
    title: (resource.summary?.trim() || 'Không có tiêu đề').slice(0, 150),
    description: (resource.description ?? '').slice(0, 2000),
    startDate,
    endDate,
    isAllDay,
    location: (resource.location ?? '').slice(0, 200),
    onlineMeetingUrl: (resource.hangoutLink ?? '').slice(0, 500),
    availability: resource.transparency === 'transparent' ? 'free' : 'busy',
    visibility: resource.visibility ?? 'default',
    timeZone,
    eventColorId,
    eventLabelId,
    eventColor,
    recurrence: {
      frequency: rec.frequency,
      interval: rec.interval,
      daysOfWeek: rec.daysOfWeek ?? [],
      until: rec.until ? new Date(rec.until) : null,
      count: rec.count ?? null,
    },
    exceptionDates,
    originalStartTime: parseGoogleOriginalStartTime(resource, timeZone),
    etag: resource.etag ?? '',
    updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
  }
}

export type SyncableConflictField =
  | 'title'
  | 'description'
  | 'startDate'
  | 'endDate'
  | 'isAllDay'
  | 'location'
  | 'onlineMeetingUrl'
  | 'availability'
  | 'visibility'
  | 'timeZone'
  | 'recurrence'

export interface NormalizedSyncSnapshot {
  title: string
  description: string
  startDate: Date
  endDate: Date
  isAllDay: boolean
  location: string
  onlineMeetingUrl: string
  availability: EventAvailability
  visibility: EventVisibility
  timeZone: string
  recurrence: {
    frequency: RecurrenceFrequency
    interval: number
    daysOfWeek: number[]
    until: Date | null
    count: number | null
  }
}

export const toNormalizedSyncSnapshot = (source: {
  title: string
  description?: string | null
  startDate: Date
  endDate: Date
  isAllDay?: boolean | null
  location?: string | null
  onlineMeetingUrl?: string | null
  availability?: EventAvailability | null
  visibility?: EventVisibility | null
  timeZone?: string | null
  recurrence?: {
    frequency?: RecurrenceFrequency | null
    interval?: number | null
    daysOfWeek?: number[] | null
    until?: Date | null
    count?: number | null
  } | null
}): NormalizedSyncSnapshot => ({
  title: (source.title ?? '').trim(),
  description: (source.description ?? '').trim(),
  startDate: new Date(source.startDate),
  endDate: new Date(source.endDate),
  isAllDay: Boolean(source.isAllDay),
  location: (source.location ?? '').trim(),
  onlineMeetingUrl: (source.onlineMeetingUrl ?? '').trim(),
  availability: source.availability === 'free' ? 'free' : 'busy',
  visibility: source.visibility === 'public' || source.visibility === 'private' ? source.visibility : 'default',
  timeZone: normalizeTimeZone(source.timeZone ?? undefined),
  recurrence: {
    frequency: source.recurrence?.frequency ?? 'none',
    interval: Math.max(1, source.recurrence?.interval ?? 1),
    daysOfWeek: [...(source.recurrence?.daysOfWeek ?? [])].sort((a, b) => a - b),
    until: source.recurrence?.until ? new Date(source.recurrence.until) : null,
    count: source.recurrence?.count ?? null,
  },
})

const areFieldValuesEqual = (
  field: SyncableConflictField,
  left: NormalizedSyncSnapshot,
  right: NormalizedSyncSnapshot,
): boolean => {
  switch (field) {
    case 'title':
    case 'description':
    case 'location':
    case 'onlineMeetingUrl':
    case 'timeZone':
      return left[field].trim() === right[field].trim()
    case 'isAllDay':
    case 'availability':
    case 'visibility':
      return left[field] === right[field]
    case 'startDate':
    case 'endDate':
      return Math.abs(left[field].getTime() - right[field].getTime()) <= 1000
    case 'recurrence': {
      const a = left.recurrence
      const b = right.recurrence
      if (a.frequency !== b.frequency) return false
      if (a.frequency === 'none') return true
      const aUntil = a.until ? Math.floor(a.until.getTime() / 1000) : null
      const bUntil = b.until ? Math.floor(b.until.getTime() / 1000) : null
      return (
        a.interval === b.interval &&
        a.count === b.count &&
        aUntil === bUntil &&
        a.daysOfWeek.join(',') === b.daysOfWeek.join(',')
      )
    }
  }
}

const ALL_SYNC_FIELDS: readonly SyncableConflictField[] = [
  'title',
  'description',
  'startDate',
  'endDate',
  'isAllDay',
  'location',
  'onlineMeetingUrl',
  'availability',
  'visibility',
  'timeZone',
  'recurrence',
]

export interface ThreeWayMergeResult {
  mergedLocalFields: Partial<NormalizedSyncSnapshot>
  needsPushToRemote: boolean
  conflictedFields: SyncableConflictField[]
}

export const computeThreeWaySyncDiff = (
  base: NormalizedSyncSnapshot | undefined,
  local: NormalizedSyncSnapshot,
  remote: NormalizedSyncSnapshot,
): ThreeWayMergeResult => {
  const mergedLocalFields: Record<string, unknown> = {}
  const conflictedFields: SyncableConflictField[] = []
  let needsPushToRemote = false

  if (!base) {
    for (const field of ALL_SYNC_FIELDS) {
      if (!areFieldValuesEqual(field, local, remote)) {
        conflictedFields.push(field)
      }
    }
    return {
      mergedLocalFields: mergedLocalFields as Partial<NormalizedSyncSnapshot>,
      needsPushToRemote: false,
      conflictedFields,
    }
  }

  for (const field of ALL_SYNC_FIELDS) {
    const localChanged = !areFieldValuesEqual(field, base, local)
    const remoteChanged = !areFieldValuesEqual(field, base, remote)

    if (!localChanged && remoteChanged) {
      mergedLocalFields[field] = remote[field]
    } else if (localChanged && !remoteChanged) {
      needsPushToRemote = true
    } else if (localChanged && remoteChanged) {
      if (!areFieldValuesEqual(field, local, remote)) {
        conflictedFields.push(field)
      }
    }
  }

  return {
    mergedLocalFields: mergedLocalFields as Partial<NormalizedSyncSnapshot>,
    needsPushToRemote,
    conflictedFields,
  }
}

export interface ComparableEventSnapshot {
  title: string
  description?: string
  startDate: Date
  endDate: Date
  isAllDay?: boolean
  location?: string
  availability?: EventAvailability
  visibility?: EventVisibility
}

export const hasComparableEventDifferences = (
  left: ComparableEventSnapshot,
  right: ComparableEventSnapshot,
): boolean => {
  const normLeft = toNormalizedSyncSnapshot(left)
  const normRight = toNormalizedSyncSnapshot(right)
  return (
    !areFieldValuesEqual('title', normLeft, normRight) ||
    !areFieldValuesEqual('description', normLeft, normRight) ||
    !areFieldValuesEqual('isAllDay', normLeft, normRight) ||
    !areFieldValuesEqual('startDate', normLeft, normRight) ||
    !areFieldValuesEqual('endDate', normLeft, normRight) ||
    !areFieldValuesEqual('location', normLeft, normRight) ||
    !areFieldValuesEqual('availability', normLeft, normRight) ||
    !areFieldValuesEqual('visibility', normLeft, normRight)
  )
}
