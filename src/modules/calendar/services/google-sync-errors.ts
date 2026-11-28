import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import { GoogleCalendarApiError } from '@/modules/calendar/services/google-calendar.adapter.js'
import type { NormalizedSyncSnapshot } from '@/modules/calendar/services/google-calendar-mapper.js'

export const TOKEN_REFRESH_BUFFER_MS = 60_000
export const ONLINE_POLL_SYNC_INTERVAL_MS = 5 * 60 * 1000
export const PASSIVE_FALLBACK_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
export const BASE_RETRY_DELAY_MS = 60_000
export const MAX_RETRY_DELAY_MS = 30 * 60 * 1000
export const MAX_AUTOMATIC_RETRIES = 5
export const WORKER_LEASE_MS = 3 * 60 * 1000

export type GoogleSyncJobType =
  | 'full_sync'
  | 'incremental_sync'
  | 'event_push'
  | 'event_delete'
  | 'conflict_resolve'

export type ClaimedSyncJob = NonNullable<
  Awaited<ReturnType<typeof googleCalendarRepository.updateJobById>>
>

export const isTokenRevokedError = (error: unknown): boolean => {
  if (!(error instanceof GoogleCalendarApiError)) return false
  return (
    error.status === 401 ||
    error.reason === 'invalid_grant' ||
    error.reason === 'invalid_token' ||
    error.reason === 'authError' ||
    error.reason === 'unauthorized_client'
  )
}

export const isRetryableRateOrServerError = (error: unknown): boolean => {
  if (!(error instanceof GoogleCalendarApiError)) return true
  if (error.status === 429 || error.status === 502 || error.status >= 500) return true
  return (
    error.status === 403 &&
    (error.reason === 'rateLimitExceeded' || error.reason === 'userRateLimitExceeded')
  )
}

export const isReadOnlyForbiddenError = (error: unknown): boolean =>
  error instanceof GoogleCalendarApiError &&
  error.status === 403 &&
  error.reason !== 'rateLimitExceeded' &&
  error.reason !== 'userRateLimitExceeded'

export const computeExponentialBackoffDelayMs = (
  retriesUsed: number,
  retryAfterMs?: number,
): number => {
  const jitterMs = Math.floor(Math.random() * 10_000)
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(5_000, retryAfterMs) + jitterMs)
  }
  const exponential = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, retriesUsed)
  return Math.min(MAX_RETRY_DELAY_MS, exponential + jitterMs)
}

export const snapshotToDbRecord = (snap: NormalizedSyncSnapshot): Record<string, unknown> => ({
  title: snap.title,
  description: snap.description,
  startDate: snap.startDate,
  endDate: snap.endDate,
  isAllDay: snap.isAllDay,
  location: snap.location,
  onlineMeetingUrl: snap.onlineMeetingUrl,
  availability: snap.availability,
  visibility: snap.visibility,
  timeZone: snap.timeZone,
  recurrence: snap.recurrence,
})
