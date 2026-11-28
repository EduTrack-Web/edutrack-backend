import { getCalendarOAuthCredentials } from '@/modules/calendar/services/google-calendar-oauth.config.js'
import type { GoogleCalendarAccessRole } from '@/modules/calendar/types/calendar.types.js'

const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const REQUEST_TIMEOUT_MS = 12_000

export const GOOGLE_EVENT_COLOR_PALETTE: Readonly<Record<string, string>> = {
  '1': '#7986CB',
  '2': '#33B679',
  '3': '#8E24AA',
  '4': '#E67C73',
  '5': '#F6BF26',
  '6': '#F4511E',
  '7': '#039BE5',
  '8': '#616161',
  '9': '#3F51B5',
  '10': '#0B8043',
  '11': '#D50000',
}

const GOOGLE_CALENDAR_COLOR_PALETTE: Readonly<Record<string, { legacyHex: string; modernHex: string }>> = {
  '1': { legacyHex: '#ac725e', modernHex: '#795548' },
  '2': { legacyHex: '#d06b64', modernHex: '#E67C73' },
  '3': { legacyHex: '#f83a22', modernHex: '#D50000' },
  '4': { legacyHex: '#fa573c', modernHex: '#F4511E' },
  '5': { legacyHex: '#ff7537', modernHex: '#EF6C00' },
  '6': { legacyHex: '#ffad46', modernHex: '#F09300' },
  '7': { legacyHex: '#42d692', modernHex: '#009688' },
  '8': { legacyHex: '#16a765', modernHex: '#0B8043' },
  '9': { legacyHex: '#7bd148', modernHex: '#7CB342' },
  '10': { legacyHex: '#b3dc6c', modernHex: '#C0CA33' },
  '11': { legacyHex: '#fbe983', modernHex: '#E4C441' },
  '12': { legacyHex: '#fad165', modernHex: '#F6BF26' },
  '13': { legacyHex: '#92e1c0', modernHex: '#33B679' },
  '14': { legacyHex: '#9fe1e7', modernHex: '#039BE5' },
  '15': { legacyHex: '#9fc6e7', modernHex: '#4285F4' },
  '16': { legacyHex: '#4986e7', modernHex: '#3F51B5' },
  '17': { legacyHex: '#9a9cff', modernHex: '#7986CB' },
  '18': { legacyHex: '#b99aff', modernHex: '#B39DDB' },
  '19': { legacyHex: '#c2c2c2', modernHex: '#616161' },
  '20': { legacyHex: '#cabdbf', modernHex: '#A79B8E' },
  '21': { legacyHex: '#cca6ac', modernHex: '#AD1457' },
  '22': { legacyHex: '#f691b2', modernHex: '#D81B60' },
  '23': { legacyHex: '#cd74e6', modernHex: '#8E24AA' },
  '24': { legacyHex: '#a47ae2', modernHex: '#9E69AF' },
}

export const resolveModernGoogleCalendarColor = (
  rawBackgroundColor: unknown,
  rawColorId?: unknown,
): string => {
  const cleanBg = typeof rawBackgroundColor === 'string' ? rawBackgroundColor.trim() : ''
  const cleanColorId = typeof rawColorId === 'string' ? rawColorId.trim() : ''
  const paletteEntry = cleanColorId ? GOOGLE_CALENDAR_COLOR_PALETTE[cleanColorId] : undefined
  if (paletteEntry && (!cleanBg || cleanBg.toLowerCase() === paletteEntry.legacyHex)) {
    return paletteEntry.modernHex
  }
  return cleanBg || '#2563EB'
}

export interface GoogleEventDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GoogleEventPerson {
  email?: string
  displayName?: string
  self?: boolean
}

export interface GoogleCalendarEventResource {
  id: string
  etag?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  updated?: string
  colorId?: string
  eventLabelId?: string
  transparency?: 'opaque' | 'transparent'
  visibility?: 'default' | 'public' | 'private'
  eventType?: string
  locked?: boolean
  guestsCanModify?: boolean
  creator?: GoogleEventPerson
  organizer?: GoogleEventPerson
  recurringEventId?: string
  originalStartTime?: GoogleEventDateTime
  start?: GoogleEventDateTime
  end?: GoogleEventDateTime
  recurrence?: string[]
}

export interface GoogleCalendarListItemResource {
  id: string
  summary: string
  description: string
  backgroundColor: string
  foregroundColor: string
  timeZone: string
  accessRole: GoogleCalendarAccessRole
  primary: boolean
}

export interface GoogleEventUpsertPayload {
  summary?: string
  description?: string
  location?: string
  status?: 'confirmed' | 'cancelled'
  colorId?: string | null
  eventLabelId?: string | null
  start?: GoogleEventDateTime
  end?: GoogleEventDateTime
  transparency?: 'opaque' | 'transparent'
  visibility?: 'default' | 'public' | 'private'
  recurrence?: string[]
}

export interface GoogleListEventsResult {
  items: GoogleCalendarEventResource[]
  nextPageToken?: string
  nextSyncToken?: string
}

export interface GoogleRefreshedTokenResult {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export interface GoogleWatchChannelResult {
  channelId: string
  resourceId: string
  expiration: Date
}

export class GoogleCalendarApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly reason: string,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'GoogleCalendarApiError'
  }
}

export interface GoogleCalendarAdapter {
  getColors?(accessToken: string): Promise<Record<string, string>>
  getCalendarEventLabels?(accessToken: string, calendarId: string): Promise<Record<string, string>>
  watchEvents?(params: {
    accessToken: string
    calendarId: string
    channelId: string
    webhookToken: string
    webhookUrl: string
    ttlSeconds: number
  }): Promise<GoogleWatchChannelResult>
  stopWatchChannel?(params: {
    accessToken: string
    channelId: string
    resourceId: string
  }): Promise<void>
  refreshAccessToken(refreshToken: string): Promise<GoogleRefreshedTokenResult>
  revokeToken(token: string): Promise<void>
  listCalendars(accessToken: string): Promise<GoogleCalendarListItemResource[]>
  listEvents(params: {
    accessToken: string
    calendarId: string
    syncToken?: string
    pageToken?: string
    showDeleted?: boolean
  }): Promise<GoogleListEventsResult>
  listEventInstances(params: {
    accessToken: string
    calendarId: string
    recurringEventId: string
    originalStart: string
  }): Promise<GoogleCalendarEventResource[]>
  insertEvent(params: {
    accessToken: string
    calendarId: string
    payload: GoogleEventUpsertPayload
  }): Promise<GoogleCalendarEventResource>
  updateEvent(params: {
    accessToken: string
    calendarId: string
    googleEventId: string
    payload: GoogleEventUpsertPayload
  }): Promise<GoogleCalendarEventResource>
  deleteEvent(params: {
    accessToken: string
    calendarId: string
    googleEventId: string
  }): Promise<void>
}

export const resolveGoogleCalendarClientCredentials = (): {
  clientId: string
  clientSecret: string
} | null => getCalendarOAuthCredentials()

const readJsonSafely = async (response: globalThis.Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const parseRetryAfterMs = (response: globalThis.Response): number | undefined => {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30 * 60 * 1000)
  }
  const parsedDate = Date.parse(raw)
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, Math.min(parsedDate - Date.now(), 30 * 60 * 1000))
  }
  return undefined
}

const extractGoogleErrorReason = (body: unknown): string => {
  if (typeof body !== 'object' || body === null) return ''
  const record = body as Record<string, unknown>
  if (typeof record.error === 'string') return record.error
  if (typeof record.error === 'object' && record.error !== null) {
    const errObj = record.error as Record<string, unknown>
    if (Array.isArray(errObj.errors) && errObj.errors.length > 0) {
      const first = errObj.errors[0] as Record<string, unknown> | undefined
      if (first && typeof first.reason === 'string') return first.reason
    }
    if (typeof errObj.status === 'string') return errObj.status
  }
  return ''
}

const parseDateTimeObj = (raw: unknown): GoogleEventDateTime | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const dt = raw as Record<string, unknown>
  return {
    ...(typeof dt.date === 'string' ? { date: dt.date } : {}),
    ...(typeof dt.dateTime === 'string' ? { dateTime: dt.dateTime } : {}),
    ...(typeof dt.timeZone === 'string' ? { timeZone: dt.timeZone } : {}),
  }
}

const parsePersonObj = (raw: unknown): GoogleEventPerson | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const person = raw as Record<string, unknown>
  return {
    ...(typeof person.email === 'string' ? { email: person.email.trim().toLowerCase() } : {}),
    ...(typeof person.displayName === 'string' ? { displayName: person.displayName } : {}),
    ...(typeof person.self === 'boolean' ? { self: person.self } : {}),
  }
}

const parseGoogleEventResource = (value: unknown): GoogleCalendarEventResource | null => {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null

  return {
    id: record.id,
    ...(typeof record.etag === 'string' ? { etag: record.etag } : {}),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.summary === 'string' ? { summary: record.summary } : {}),
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(typeof record.location === 'string' ? { location: record.location } : {}),
    ...(typeof record.hangoutLink === 'string' ? { hangoutLink: record.hangoutLink } : {}),
    ...(typeof record.updated === 'string' ? { updated: record.updated } : {}),
    ...(typeof record.colorId === 'string' ? { colorId: record.colorId } : {}),
    ...(typeof record.eventLabelId === 'string' ? { eventLabelId: record.eventLabelId } : {}),
    ...(record.transparency === 'opaque' || record.transparency === 'transparent'
      ? { transparency: record.transparency }
      : {}),
    ...(record.visibility === 'default' || record.visibility === 'public' || record.visibility === 'private'
      ? { visibility: record.visibility }
      : {}),
    ...(typeof record.eventType === 'string' ? { eventType: record.eventType } : {}),
    ...(typeof record.locked === 'boolean' ? { locked: record.locked } : {}),
    ...(typeof record.guestsCanModify === 'boolean' ? { guestsCanModify: record.guestsCanModify } : {}),
    ...(record.creator ? { creator: parsePersonObj(record.creator) } : {}),
    ...(record.organizer ? { organizer: parsePersonObj(record.organizer) } : {}),
    ...(typeof record.recurringEventId === 'string' ? { recurringEventId: record.recurringEventId } : {}),
    ...(record.originalStartTime ? { originalStartTime: parseDateTimeObj(record.originalStartTime) } : {}),
    ...(record.start ? { start: parseDateTimeObj(record.start) } : {}),
    ...(record.end ? { end: parseDateTimeObj(record.end) } : {}),
    ...(Array.isArray(record.recurrence)
      ? { recurrence: record.recurrence.filter((item): item is string => typeof item === 'string') }
      : {}),
  }
}

const normalizeAccessRole = (raw: unknown): GoogleCalendarAccessRole => {
  if (raw === 'owner' || raw === 'writer' || raw === 'reader' || raw === 'freeBusyReader') {
    return raw
  }
  return 'reader'
}

export const httpGoogleCalendarAdapter: GoogleCalendarAdapter = {
  async getColors(accessToken: string): Promise<Record<string, string>> {
    let response: globalThis.Response
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/colors`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Không thể kết nối đến Google để tải bảng màu.')
    }

    const body = await readJsonSafely(response)
    if (!response.ok) {
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể tải bảng màu sự kiện từ Google.',
        parseRetryAfterMs(response),
      )
    }

    const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const rawEvents =
      typeof record.event === 'object' && record.event !== null
        ? (record.event as Record<string, unknown>)
        : {}
    const palette: Record<string, string> = { ...GOOGLE_EVENT_COLOR_PALETTE }
    for (const [colorId, colorDef] of Object.entries(rawEvents)) {
      if (colorId in palette) continue
      if (typeof colorDef === 'object' && colorDef !== null && 'background' in colorDef) {
        const bg = (colorDef as Record<string, unknown>).background
        if (typeof bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(bg.trim())) {
          palette[colorId] = bg.trim().toUpperCase()
        }
      }
    }
    return palette
  },

  async getCalendarEventLabels(accessToken: string, calendarId: string): Promise<Record<string, string>> {
    let response: globalThis.Response
    try {
      response = await fetch(
        `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}?eventLabelVersion=1`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      return {}
    }

    if (!response.ok) {
      return {}
    }

    const body = await readJsonSafely(response)
    const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const labelProps =
      typeof record.labelProperties === 'object' && record.labelProperties !== null
        ? (record.labelProperties as Record<string, unknown>)
        : null
    const rawLabels = labelProps && Array.isArray(labelProps.eventLabels) ? labelProps.eventLabels : []
    const labelMap: Record<string, string> = {}
    for (const rawLabel of rawLabels) {
      if (typeof rawLabel !== 'object' || rawLabel === null) continue
      const label = rawLabel as Record<string, unknown>
      const id = typeof label.id === 'string' ? label.id.trim() : ''
      const bg = typeof label.backgroundColor === 'string' ? label.backgroundColor.trim() : ''
      if (id && /^#[0-9a-fA-F]{3,6}$/.test(bg)) {
        labelMap[id] = bg.toUpperCase()
      }
    }
    return labelMap
  },

  async refreshAccessToken(refreshToken: string): Promise<GoogleRefreshedTokenResult> {
    const creds = resolveGoogleCalendarClientCredentials()
    if (!creds) {
      throw new GoogleCalendarApiError(503, 'notConfigured', 'Google OAuth chưa được cấu hình.')
    }

    let response: globalThis.Response
    try {
      response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Không thể kết nối đến Google lúc này.')
    }

    const body = await readJsonSafely(response)
    if (!response.ok) {
      const reason = extractGoogleErrorReason(body) || 'refresh_failed'
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể làm mới phiên Google Lịch.',
        parseRetryAfterMs(response),
      )
    }

    if (
      typeof body !== 'object' ||
      body === null ||
      !('access_token' in body) ||
      typeof body.access_token !== 'string'
    ) {
      throw new GoogleCalendarApiError(502, 'invalidResponse', 'Phản hồi làm mới token Google không hợp lệ.')
    }

    const record = body as Record<string, unknown>
    const expiresIn = typeof record.expires_in === 'number' && record.expires_in > 0 ? record.expires_in : 3600
    const nextRefresh = typeof record.refresh_token === 'string' && record.refresh_token ? record.refresh_token : undefined

    return {
      accessToken: body.access_token,
      ...(nextRefresh ? { refreshToken: nextRefresh } : {}),
      expiresIn,
    }
  },

  async revokeToken(token: string): Promise<void> {
    if (!token) return
    try {
      await fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return
    }
  },

  async listCalendars(accessToken: string): Promise<GoogleCalendarListItemResource[]> {
    const collected: GoogleCalendarListItemResource[] = []
    let pageToken: string | undefined

    do {
      const query = new URLSearchParams({ maxResults: '250', showHidden: 'false' })
      if (pageToken) query.set('pageToken', pageToken)

      let response: globalThis.Response
      try {
        response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/users/me/calendarList?${query.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối khi tải danh sách Google Calendar.')
      }

      const body = await readJsonSafely(response)
      if (!response.ok) {
        const reason = extractGoogleErrorReason(body)
        throw new GoogleCalendarApiError(
          response.status,
          reason,
          'Không thể tải danh sách lịch từ Google Calendar.',
          parseRetryAfterMs(response),
        )
      }

      const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
      const items = Array.isArray(record.items) ? record.items : []
      for (const raw of items) {
        if (typeof raw !== 'object' || raw === null) continue
        const item = raw as Record<string, unknown>
        if (typeof item.id !== 'string' || !item.id) continue
        collected.push({
          id: item.id,
          summary:
            (typeof item.summaryOverride === 'string' && item.summaryOverride.trim()) ||
            (typeof item.summary === 'string' && item.summary.trim()) ||
            item.id,
          description: typeof item.description === 'string' ? item.description : '',
          backgroundColor: resolveModernGoogleCalendarColor(item.backgroundColor, item.colorId),
          foregroundColor:
            typeof item.foregroundColor === 'string' && item.foregroundColor.trim()
              ? item.foregroundColor.trim()
              : '#FFFFFF',
          timeZone: typeof item.timeZone === 'string' && item.timeZone ? item.timeZone : 'Asia/Ho_Chi_Minh',
          accessRole: normalizeAccessRole(item.accessRole),
          primary: Boolean(item.primary),
        })
      }

      pageToken = typeof record.nextPageToken === 'string' && record.nextPageToken ? record.nextPageToken : undefined
    } while (pageToken)

    return collected
  },

  async listEvents({ accessToken, calendarId, syncToken, pageToken, showDeleted = true }): Promise<GoogleListEventsResult> {
    const fetchPage = async (includeLabelVersion: boolean) => {
      const query = new URLSearchParams({
        maxResults: '250',
        singleEvents: 'false',
        showDeleted: showDeleted ? 'true' : 'false',
      })
      if (includeLabelVersion) {
        query.set('eventLabelVersion', '1')
      }
      if (syncToken) {
        query.set('syncToken', syncToken)
      }
      if (pageToken) query.set('pageToken', pageToken)

      let response: globalThis.Response
      try {
        response = await fetch(
          `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )
      } catch {
        throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối đến Google Lịch.')
      }
      const body = await readJsonSafely(response)
      return { response, body }
    }

    let { response, body } = await fetchPage(true)
    if (!response.ok && response.status === 400 && !syncToken) {
      const fallback = await fetchPage(false)
      response = fallback.response
      body = fallback.body
    }

    if (!response.ok) {
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể tải danh sách sự kiện từ Google Lịch.',
        parseRetryAfterMs(response),
      )
    }

    const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const rawItems = Array.isArray(record.items) ? record.items : []
    const items = rawItems
      .map(parseGoogleEventResource)
      .filter((item): item is GoogleCalendarEventResource => item !== null)

    return {
      items,
      ...(typeof record.nextPageToken === 'string' ? { nextPageToken: record.nextPageToken } : {}),
      ...(typeof record.nextSyncToken === 'string' ? { nextSyncToken: record.nextSyncToken } : {}),
    }
  },

  async listEventInstances({ accessToken, calendarId, recurringEventId, originalStart }): Promise<GoogleCalendarEventResource[]> {
    const query = new URLSearchParams({
      originalStart,
      maxResults: '10',
      eventLabelVersion: '1',
    })
    let response: globalThis.Response
    try {
      response = await fetch(
        `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(recurringEventId)}/instances?${query.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối khi truy vấn instance sự kiện lặp lại.')
    }

    let body = await readJsonSafely(response)
    if (!response.ok && response.status === 400) {
      const fallbackQuery = new URLSearchParams({ originalStart, maxResults: '10' })
      try {
        response = await fetch(
          `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(recurringEventId)}/instances?${fallbackQuery.toString()}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )
        body = await readJsonSafely(response)
      } catch {
        throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối khi truy vấn instance sự kiện lặp lại.')
      }
    }
    if (!response.ok) {
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể tải thông tin instance lặp lại từ Google.',
        parseRetryAfterMs(response),
      )
    }

    const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const rawItems = Array.isArray(record.items) ? record.items : []
    return rawItems
      .map(parseGoogleEventResource)
      .filter((item): item is GoogleCalendarEventResource => item !== null)
  },

  async insertEvent({ accessToken, calendarId, payload }): Promise<GoogleCalendarEventResource> {
    const insertPayload = payload.colorId === null
      ? (() => {
          const { colorId: _ignored, ...rest } = payload
          return rest
        })()
      : payload
    let response: globalThis.Response
    try {
      response = await fetch(
        `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(insertPayload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối khi đẩy sự kiện sang Google Lịch.')
    }

    const body = await readJsonSafely(response)
    if (!response.ok) {
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể tạo sự kiện trên Google Lịch.',
        parseRetryAfterMs(response),
      )
    }

    const parsed = parseGoogleEventResource(body)
    if (!parsed) {
      throw new GoogleCalendarApiError(502, 'invalidResponse', 'Google Lịch trả về sự kiện không hợp lệ.')
    }
    return parsed
  },

  async updateEvent({ accessToken, calendarId, googleEventId, payload }): Promise<GoogleCalendarEventResource> {
    let response: globalThis.Response
    try {
      response = await fetch(
        `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối khi cập nhật sự kiện trên Google Lịch.')
    }

    const body = await readJsonSafely(response)
    if (!response.ok) {
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể cập nhật sự kiện trên Google Lịch.',
        parseRetryAfterMs(response),
      )
    }

    const parsed = parseGoogleEventResource(body)
    if (!parsed) {
      throw new GoogleCalendarApiError(502, 'invalidResponse', 'Google Lịch trả về dữ liệu cập nhật không hợp lệ.')
    }
    return parsed
  },

  async deleteEvent({ accessToken, calendarId, googleEventId }): Promise<void> {
    let response: globalThis.Response
    try {
      response = await fetch(
        `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Lỗi kết nối khi xóa sự kiện trên Google Lịch.')
    }

    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const body = await readJsonSafely(response)
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể xóa sự kiện trên Google Lịch.',
        parseRetryAfterMs(response),
      )
    }
  },

  async watchEvents({
    accessToken,
    calendarId,
    channelId,
    webhookToken,
    webhookUrl,
    ttlSeconds,
  }): Promise<GoogleWatchChannelResult> {
    let response: globalThis.Response
    try {
      response = await fetch(
        `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: channelId,
            type: 'web_hook',
            address: webhookUrl,
            token: webhookToken,
            params: { ttl: String(ttlSeconds) },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
    } catch {
      throw new GoogleCalendarApiError(502, 'networkError', 'Không thể kết nối đến Google để đăng ký kênh đồng bộ.')
    }

    const body = await readJsonSafely(response)
    if (!response.ok) {
      const reason = extractGoogleErrorReason(body)
      throw new GoogleCalendarApiError(
        response.status,
        reason,
        'Không thể đăng ký kênh thông báo đẩy từ Google Lịch.',
        parseRetryAfterMs(response),
      )
    }

    const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const returnedId = typeof record.id === 'string' ? record.id : channelId
    const resourceId = typeof record.resourceId === 'string' ? record.resourceId : ''
    const rawExpiration =
      typeof record.expiration === 'string' || typeof record.expiration === 'number'
        ? Number(record.expiration)
        : Number.NaN
    if (!resourceId || !Number.isFinite(rawExpiration)) {
      throw new GoogleCalendarApiError(502, 'invalidResponse', 'Phản hồi kênh thông báo Google Lịch không hợp lệ.')
    }

    return {
      channelId: returnedId,
      resourceId,
      expiration: new Date(rawExpiration),
    }
  },

  async stopWatchChannel({ accessToken, channelId, resourceId }): Promise<void> {
    if (!channelId || !resourceId) return
    try {
      await fetch(`${GOOGLE_CALENDAR_API_BASE}/channels/stop`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: channelId, resourceId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return
    }
  },
}
