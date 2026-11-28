import assert from 'node:assert/strict'
import test from 'node:test'

import { Types } from 'mongoose'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import {
  computeThreeWaySyncDiff,
  findClosestGoogleEventColorId,
  fromGoogleRecurrence,
  fromGoogleRecurrenceWithExceptions,
  googleEventToLocalFields,
  hasComparableEventDifferences,
  isGoogleEventEditable,
  localEventToGooglePayload,
  toGoogleRecurrence,
  toNormalizedSyncSnapshot,
} from '@/modules/calendar/services/google-calendar-mapper.js'
import {
  resolveModernGoogleCalendarColor,
  type GoogleCalendarAdapter,
} from '@/modules/calendar/services/google-calendar.adapter.js'
import {
  decodeCalendarOAuthState,
  encodeCalendarOAuthState,
} from '@/modules/calendar/services/google-calendar-oauth.service.js'
import { isSeparateGoogleOAuthProject } from '@/modules/calendar/services/google-calendar-oauth.config.js'
import {
  computeExponentialBackoffDelayMs,
  GoogleCalendarSyncService,
} from '@/modules/calendar/services/google-calendar-sync.service.js'
import {
  ONLINE_POLL_SYNC_INTERVAL_MS,
  PASSIVE_FALLBACK_SYNC_INTERVAL_MS,
} from '@/modules/calendar/services/google-sync-errors.js'
import { GoogleSyncRealtimeHub } from '@/modules/calendar/services/google-sync-realtime.hub.js'
import { GoogleTokenManager } from '@/modules/calendar/services/google-token.manager.js'
import {
  GoogleWatchChannelManager,
  hashWebhookToken,
  resolveValidHttpsWebhookUrl,
  verifyWebhookTokenHash,
} from '@/modules/calendar/services/google-watch-channel.manager.js'
import { decryptToken, encryptToken } from '@/modules/calendar/services/token-crypto.js'

test('signs and validates Google Calendar OAuth state and rejects tampered payloads', () => {
  const encoded = encodeCalendarOAuthState({
    purpose: 'calendar_sync',
    mode: 'add',
    nonce: 'nonce-123456',
    userId: 'user-abc',
    iat: Date.now(),
  })

  const decoded = decodeCalendarOAuthState(encoded)
  assert.equal(decoded?.userId, 'user-abc')
  assert.equal(decoded?.nonce, 'nonce-123456')
  assert.equal(decoded?.mode, 'add')

  const [payloadPart, signaturePart] = encoded.split('.')
  const tamperedPayload = Buffer.from(
    JSON.stringify({ purpose: 'calendar_sync', mode: 'add', nonce: 'nonce-123456', userId: 'attacker', iat: Date.now() }),
    'utf8',
  ).toString('base64url')
  assert.equal(decodeCalendarOAuthState(`${tamperedPayload}.${signaturePart}`), null)
  assert.equal(decodeCalendarOAuthState(`${payloadPart}.invalid_sig`), null)
  assert.equal(decodeCalendarOAuthState(''), null)
})

test('encryptToken and decryptToken round-trip Google OAuth tokens without exposing plaintext', () => {
  const secretToken = '1//0gExampleRefreshTokenValue_Abc123'
  const encrypted = encryptToken(secretToken)

  assert.notEqual(encrypted, secretToken)
  assert.ok(!encrypted.includes(secretToken))
  assert.equal(decryptToken(encrypted), secretToken)
  assert.equal(decryptToken('malformed-payload'), '')
})

test('maps all-day EduTrack events with inclusive end dates to Google exclusive end dates and back', () => {
  const localStart = new Date('2026-11-25T00:00:00+07:00')
  const localEnd = new Date('2026-11-26T23:59:59+07:00')

  const payload = localEventToGooglePayload({
    title: 'Hội thảo EduTrack',
    description: 'Cả ngày',
    startDate: localStart,
    endDate: localEnd,
    isAllDay: true,
    location: 'Hội trường A',
    availability: 'busy',
    visibility: 'default',
    timeZone: 'Asia/Ho_Chi_Minh',
  })

  assert.equal(payload.start?.date, '2026-11-25')
  assert.equal(payload.end?.date, '2026-11-27')
  assert.equal(payload.start?.dateTime, undefined)

  const mappedBack = googleEventToLocalFields({
    id: 'g-evt-1',
    etag: '"etag-1"',
    summary: 'Hội thảo EduTrack',
    description: 'Cả ngày',
    location: 'Hội trường A',
    colorId: '10',
    start: { date: '2026-11-25', timeZone: 'Asia/Ho_Chi_Minh' },
    end: { date: '2026-11-27', timeZone: 'Asia/Ho_Chi_Minh' },
  })

  assert.ok(mappedBack)
  assert.equal(mappedBack.isAllDay, true)
  assert.equal(mappedBack.eventColor, '#0B8043')
  assert.equal(mappedBack.startDate.toISOString(), new Date('2026-11-25T00:00:00+07:00').toISOString())
  assert.equal(mappedBack.endDate.toISOString(), new Date('2026-11-26T23:59:59+07:00').toISOString())
})

test('maps timed events, recurrence rules, and EXDATE exceptions bidirectionally', () => {
  const exDate = new Date('2026-12-02T09:00:00Z')
  const recurrence = toGoogleRecurrence(
    {
      frequency: 'custom',
      interval: 1,
      daysOfWeek: [1, 3, 5],
      count: 10,
      until: null,
    },
    [exDate],
  )
  assert.equal(recurrence?.[0], 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;COUNT=10')
  assert.equal(recurrence?.[1], 'EXDATE:20261202T090000Z')

  const parsedWithExceptions = fromGoogleRecurrenceWithExceptions(recurrence)
  assert.equal(parsedWithExceptions.recurrence.frequency, 'custom')
  assert.deepEqual(parsedWithExceptions.recurrence.daysOfWeek, [1, 3, 5])
  assert.equal(parsedWithExceptions.recurrence.count, 10)
  assert.equal(parsedWithExceptions.exceptionDates[0]?.toISOString(), exDate.toISOString())

  const weekdaysRule = toGoogleRecurrence({
    frequency: 'weekdays',
    interval: 1,
    daysOfWeek: [],
    count: null,
    until: null,
  })
  assert.deepEqual(weekdaysRule, ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'])
  assert.equal(fromGoogleRecurrence(weekdaysRule).frequency, 'weekdays')
})

test('performs 3-way field merge: auto-merges disjoint changes and flags only conflicting fields', () => {
  const baseStart = new Date('2026-11-25T09:00:00+07:00')
  const baseEnd = new Date('2026-11-25T10:00:00+07:00')

  const base = toNormalizedSyncSnapshot({
    title: 'Họp nhóm',
    description: 'Nội dung cũ',
    startDate: baseStart,
    endDate: baseEnd,
    isAllDay: false,
    location: 'Phòng A',
    availability: 'busy',
    visibility: 'default',
    timeZone: 'Asia/Ho_Chi_Minh',
  })

  const localTitleChanged = { ...base, title: 'Họp Sprint Review' }
  const remoteLocationChanged = { ...base, location: 'Google Meet' }
  const autoMerged = computeThreeWaySyncDiff(base, localTitleChanged, remoteLocationChanged)
  assert.deepEqual(autoMerged.conflictedFields, [])
  assert.equal(autoMerged.needsPushToRemote, true)
  assert.equal(autoMerged.mergedLocalFields.location, 'Google Meet')

  const remoteTitleConflict = { ...base, title: 'Họp tổng kết', location: 'Phòng B' }
  const conflictRes = computeThreeWaySyncDiff(base, localTitleChanged, remoteTitleConflict)
  assert.deepEqual(conflictRes.conflictedFields, ['title'])
  assert.equal(conflictRes.mergedLocalFields.location, 'Phòng B')

  const sameChange = computeThreeWaySyncDiff(
    base,
    { ...base, title: 'Chốt kế hoạch' },
    { ...base, title: 'Chốt kế hoạch' },
  )
  assert.deepEqual(sameChange.conflictedFields, [])
})

test('detects concurrent conflicting edits with 2-way fallback comparator', () => {
  const baseStart = new Date('2026-11-25T09:00:00+07:00')
  const baseEnd = new Date('2026-11-25T10:00:00+07:00')

  const identical = hasComparableEventDifferences(
    {
      title: 'Họp nhóm',
      description: 'Sprint review',
      startDate: baseStart,
      endDate: baseEnd,
      isAllDay: false,
      location: 'Phòng 201',
    },
    {
      title: 'Họp nhóm ',
      description: 'Sprint review',
      startDate: baseStart,
      endDate: baseEnd,
      isAllDay: false,
      location: 'Phòng 201',
    },
  )
  assert.equal(identical, false)
})

test('enforces read-only rules based on Google accessRole, locked flag, and organizer permissions', () => {
  assert.equal(
    isGoogleEventEditable({
      accessRole: 'reader',
      accountEmail: 'minh@gmail.com',
      resource: { id: 'e1' },
    }),
    false,
  )
  assert.equal(
    isGoogleEventEditable({
      accessRole: 'freeBusyReader',
      accountEmail: 'minh@gmail.com',
      resource: { id: 'e2' },
    }),
    false,
  )
  assert.equal(
    isGoogleEventEditable({
      accessRole: 'writer',
      accountEmail: 'minh@gmail.com',
      resource: { id: 'e3', locked: true },
    }),
    false,
  )
  assert.equal(
    isGoogleEventEditable({
      accessRole: 'writer',
      accountEmail: 'minh@gmail.com',
      resource: {
        id: 'e4',
        organizer: { email: 'boss@company.com', self: false },
        guestsCanModify: false,
      },
    }),
    false,
  )
  assert.equal(
    isGoogleEventEditable({
      accessRole: 'owner',
      accountEmail: 'minh@gmail.com',
      resource: { id: 'e5' },
    }),
    true,
  )
})

test('computes bounded exponential backoff retry delays (1m base, 30m cap, Retry-After respected)', () => {
  const firstRetry = computeExponentialBackoffDelayMs(0)
  assert.ok(firstRetry >= 60_000 && firstRetry <= 70_000)

  const cappedRetry = computeExponentialBackoffDelayMs(10)
  assert.equal(cappedRetry, 30 * 60_000)

  const honored429 = computeExponentialBackoffDelayMs(0, 120_000)
  assert.ok(honored429 >= 120_000 && honored429 <= 130_000)
})

test('enforces separate Google Cloud project IDs between Login OAuth and Calendar Sync OAuth', () => {
  assert.equal(
    isSeparateGoogleOAuthProject(
      '111111111111-cal.apps.googleusercontent.com',
      '222222222222-login.apps.googleusercontent.com',
    ),
    true,
  )
  assert.equal(
    isSeparateGoogleOAuthProject(
      '111111111111-cal.apps.googleusercontent.com',
      '111111111111-login.apps.googleusercontent.com',
    ),
    false,
  )
  assert.equal(
    isSeparateGoogleOAuthProject(
      '111111111111-same.apps.googleusercontent.com',
      '111111111111-same.apps.googleusercontent.com',
    ),
    false,
  )
})

test('maps EduTrack colors to exact or closest Google Calendar colorId and clears colorId when resetting to calendar color', () => {
  assert.equal(findClosestGoogleEventColorId('#e67c73'), '4')
  assert.equal(findClosestGoogleEventColorId('#DC2626'), '11')
  assert.equal(findClosestGoogleEventColorId('#2563EB'), '9')
  assert.equal(findClosestGoogleEventColorId(''), '')

  const withExplicitColor = localEventToGooglePayload({
    title: 'Dạy cho Trang',
    startDate: new Date('2026-11-16T10:30:00Z'),
    endDate: new Date('2026-11-16T12:30:00Z'),
    color: '#0B8043',
    isGoogleLinked: true,
  })
  assert.equal(withExplicitColor.colorId, '10')

  const resetToCalendarDefault = localEventToGooglePayload({
    title: 'Dạy cho Trang',
    startDate: new Date('2026-11-16T10:30:00Z'),
    endDate: new Date('2026-11-16T12:30:00Z'),
    color: '',
    isGoogleLinked: true,
  })
  assert.equal(resetToCalendarDefault.colorId, null)

  const localWithoutColor = localEventToGooglePayload({
    title: 'Sự kiện nội bộ',
    startDate: new Date('2026-11-16T10:30:00Z'),
    endDate: new Date('2026-11-16T12:30:00Z'),
    color: '',
    isGoogleLinked: false,
  })
  assert.equal(localWithoutColor.colorId, undefined)

  const pulledWithLivePalette = googleEventToLocalFields(
    {
      id: 'g-live-1',
      colorId: '4',
      start: { dateTime: '2026-11-16T17:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
      end: { dateTime: '2026-11-16T19:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
    },
    'Asia/Ho_Chi_Minh',
    { '4': '#FF887C' },
  )
  assert.equal(pulledWithLivePalette?.eventColorId, '4')
  assert.equal(pulledWithLivePalette?.eventColor, '#FF887C')
})

test('resolves Google Calendar modern calendarList colors and eventLabelId custom labels', () => {
  assert.equal(resolveModernGoogleCalendarColor('#9fe1e7', '14'), '#039BE5')
  assert.equal(resolveModernGoogleCalendarColor('#123456', '14'), '#123456')
  assert.equal(resolveModernGoogleCalendarColor('#123456'), '#123456')
  assert.equal(resolveModernGoogleCalendarColor(''), '#2563EB')

  const labelPalette = {
    'label-beetroot': '#AD1457',
    'label-wisteria': '#B39DDB',
  }

  const pulledLabeled = googleEventToLocalFields(
    {
      id: 'g-label-1',
      eventLabelId: 'label-beetroot',
      start: { dateTime: '2026-11-25T10:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
      end: { dateTime: '2026-11-25T11:30:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
    },
    'Asia/Ho_Chi_Minh',
    undefined,
    labelPalette,
  )
  assert.equal(pulledLabeled?.eventLabelId, 'label-beetroot')
  assert.equal(pulledLabeled?.eventColor, '#AD1457')

  const pulledLegacyFallback = googleEventToLocalFields(
    {
      id: 'g-legacy-1',
      colorId: '9',
      start: { dateTime: '2026-11-25T17:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
      end: { dateTime: '2026-11-25T18:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
    },
    'Asia/Ho_Chi_Minh',
    undefined,
    labelPalette,
  )
  assert.equal(pulledLegacyFallback?.eventColorId, '9')
  assert.equal(pulledLegacyFallback?.eventColor, '#3F51B5')

  const skippedColorPush = localEventToGooglePayload({
    title: 'búp',
    startDate: new Date('2026-11-25T10:30:00+07:00'),
    endDate: new Date('2026-11-25T11:30:00+07:00'),
    color: '#AD1457',
    isGoogleLinked: true,
    skipColorPatch: true,
  })
  assert.equal('colorId' in skippedColorPush, false)
})

test('triggerIntegrationSync executes incremental_sync immediately before resolving while leaving full_sync queued', async (t) => {
  const userId = new Types.ObjectId().toString()
  const integrationId = new Types.ObjectId().toString()
  const activeCalId = new Types.ObjectId().toString()
  const pendingFullCalId = new Types.ObjectId().toString()
  const incJobId = new Types.ObjectId()

  const validEncryptedAccess = encryptToken('ya29.valid-test-access-token')
  const integrationDoc = {
    _id: new Types.ObjectId(integrationId),
    userId: new Types.ObjectId(userId),
    googleSub: 'sub-immediate-test',
    googleEmail: 'secondary@gmail.com',
    displayName: 'Secondary Gmail',
    avatarUrl: '',
    status: 'connected' as const,
    isPrimarySyncAccount: false,
    syncToGoogleEnabled: true,
    syncFromGoogleEnabled: true,
    encryptedAccessToken: validEncryptedAccess,
    encryptedRefreshToken: encryptToken('1//refresh-test'),
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    lastSyncedAt: null,
    lastError: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const activeCalendarDoc = {
    _id: new Types.ObjectId(activeCalId),
    userId: new Types.ObjectId(userId),
    integrationId: new Types.ObjectId(integrationId),
    googleCalendarId: 'secondary@gmail.com',
    summary: 'Secondary Primary',
    description: '',
    backgroundColor: '#039BE5',
    foregroundColor: '#FFFFFF',
    timeZone: 'Asia/Ho_Chi_Minh',
    accessRole: 'owner' as const,
    isPrimary: true,
    isSelected: true,
    isVisible: true,
    syncStatus: 'active' as const,
    syncToken: 'sync-token-before',
    fullSyncCheckpoint: { nextPageToken: '', syncedCount: 1, pagesProcessed: 1, completedAt: new Date() },
    lastSyncedAt: new Date(),
    nextSyncAt: new Date(),
    lastSyncError: '',
    lastSyncErrorCode: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const pendingFullCalendarDoc = {
    ...activeCalendarDoc,
    _id: new Types.ObjectId(pendingFullCalId),
    googleCalendarId: 'new-subcal@group.calendar.google.com',
    summary: 'New Sub Calendar',
    isPrimary: false,
    syncStatus: 'initial_sync_pending' as const,
    syncToken: '',
  }

  let currentIncJob: {
    _id: Types.ObjectId
    userId: Types.ObjectId
    integrationId: Types.ObjectId
    calendarConnectionId: Types.ObjectId
    mappingId: null
    eventId: null
    conflictId: null
    jobType: 'incremental_sync'
    status: 'pending' | 'running' | 'completed'
    idempotencyKey: string
    retriesUsed: number
    maxRetries: number
    nextRetryAt: Date
    checkpoint: { nextPageToken: string; processedCount: number; pendingSyncToken: string }
    leaseOwner: string | null
    leaseExpiresAt: Date | null
    lastErrorCode: string
    lastErrorMessage: string
    completedAt: Date | null
    attemptHistory: never[]
    createdAt: Date
    updatedAt: Date
  } | null = null

  const enqueuedJobTypes: Array<{ calId: string; jobType: string }> = []
  const createdEventTitles: string[] = []
  let savedNextSyncToken = ''

  t.mock.method(googleCalendarRepository, 'findIntegrationById', async () => integrationDoc)
  t.mock.method(googleCalendarRepository, 'findIntegrationsByUserId', async () => [integrationDoc])
  t.mock.method(googleCalendarRepository, 'findCalendarsByIntegrationId', async () => [
    activeCalendarDoc,
    pendingFullCalendarDoc,
  ])
  t.mock.method(googleCalendarRepository, 'findCalendarsByUserId', async () => [
    activeCalendarDoc,
    pendingFullCalendarDoc,
  ])
  t.mock.method(googleCalendarRepository, 'findCalendarById', async (_uid: string, calId: string) =>
    calId === activeCalId ? activeCalendarDoc : pendingFullCalendarDoc,
  )
  t.mock.method(googleCalendarRepository, 'upsertCalendarsFromGoogle', async () => undefined)
  t.mock.method(googleCalendarRepository, 'enqueueJob', async (doc) => {
    enqueuedJobTypes.push({
      calId: String(doc.calendarConnectionId),
      jobType: doc.jobType,
    })
    if (doc.jobType === 'incremental_sync') {
      currentIncJob = {
        _id: incJobId,
        userId: new Types.ObjectId(userId),
        integrationId: new Types.ObjectId(integrationId),
        calendarConnectionId: new Types.ObjectId(activeCalId),
        mappingId: null,
        eventId: null,
        conflictId: null,
        jobType: 'incremental_sync',
        status: 'pending',
        idempotencyKey: '',
        retriesUsed: 0,
        maxRetries: 5,
        nextRetryAt: new Date(),
        checkpoint: { nextPageToken: '', processedCount: 0, pendingSyncToken: '' },
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: '',
        lastErrorMessage: '',
        completedAt: null,
        attemptHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }
    return null
  })
  t.mock.method(
    googleCalendarRepository,
    'claimActiveJobForCalendar',
    async (calId: string, jobType: string, workerId: string) => {
      if (calId === activeCalId && jobType === 'incremental_sync' && currentIncJob) {
        currentIncJob = {
          ...currentIncJob,
          status: 'running',
          leaseOwner: workerId,
          leaseExpiresAt: new Date(Date.now() + 60_000),
        }
        return currentIncJob
      }
      return null
    },
  )
  t.mock.method(googleCalendarRepository, 'findJobById', async () => currentIncJob)
  t.mock.method(googleCalendarRepository, 'extendJobLease', async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null }))
  t.mock.method(googleCalendarRepository, 'updateJobById', async (_id, fields) => {
    if (currentIncJob && fields.status === 'completed') {
      currentIncJob = { ...currentIncJob, status: 'completed', leaseOwner: null }
    }
    return currentIncJob
  })
  t.mock.method(googleCalendarRepository, 'findMappingByGoogleId', async () => null)
  t.mock.method(googleCalendarRepository, 'createSyncedEvent', async (payload) => {
    createdEventTitles.push(String(payload.title))
    return { _id: new Types.ObjectId() } as Awaited<ReturnType<typeof googleCalendarRepository.createSyncedEvent>>
  })
  t.mock.method(googleCalendarRepository, 'upsertMapping', async () => null)
  t.mock.method(googleCalendarRepository, 'updateCalendarById', async (_calId, fields) => {
    if (typeof fields.syncToken === 'string') {
      savedNextSyncToken = fields.syncToken
    }
    return activeCalendarDoc
  })
  t.mock.method(googleCalendarRepository, 'updateIntegrationById', async () => integrationDoc)
  t.mock.method(googleCalendarRepository, 'findPendingConflictsByUserId', async () => [])
  t.mock.method(googleCalendarRepository, 'findJobsByUserId', async () => [])

  const stubAdapter: GoogleCalendarAdapter = {
    refreshAccessToken: async () => {
      throw new Error('Not expected')
    },
    revokeToken: async () => undefined,
    listCalendars: async () => [],
    listEvents: async ({ syncToken }) => {
      assert.equal(syncToken, 'sync-token-before')
      return {
        items: [
          {
            id: 'g-instant-evt-1',
            etag: '"etag-instant"',
            status: 'confirmed',
            summary: 'Sự kiện tạo từ Gmail phụ',
            start: { dateTime: '2026-11-28T14:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
            end: { dateTime: '2026-11-28T15:00:00+07:00', timeZone: 'Asia/Ho_Chi_Minh' },
          },
        ],
        nextSyncToken: 'sync-token-after',
      }
    },
    listEventInstances: async () => [],
    insertEvent: async () => {
      throw new Error('Not expected')
    },
    updateEvent: async () => {
      throw new Error('Not expected')
    },
    deleteEvent: async () => undefined,
  }

  const service = new GoogleCalendarSyncService(stubAdapter)
  await service.triggerIntegrationSync(userId, integrationId)

  assert.deepEqual(createdEventTitles, ['Sự kiện tạo từ Gmail phụ'])
  assert.equal(savedNextSyncToken, 'sync-token-after')
  assert.equal(currentIncJob?.status, 'completed')

  assert.deepEqual(enqueuedJobTypes, [
    { calId: pendingFullCalId, jobType: 'full_sync' },
    { calId: activeCalId, jobType: 'incremental_sync' },
  ])
})

test('validates HTTPS webhook URLs, verifies SHA-256 webhook tokens, and computes hybrid fallback intervals', async (t) => {
  assert.equal(resolveValidHttpsWebhookUrl('http://localhost:8888/api/v1/calendar/google/webhook'), null)
  assert.equal(resolveValidHttpsWebhookUrl('https://localhost:8888/api/v1/calendar/google/webhook'), null)
  assert.equal(resolveValidHttpsWebhookUrl('http://edutracksystem.site/webhook'), null)
  assert.equal(
    resolveValidHttpsWebhookUrl('https://api.edutracksystem.site/api/v1/calendar/google/webhook'),
    'https://api.edutracksystem.site/api/v1/calendar/google/webhook',
  )

  const secretToken = 'webhook-secret-token-xyz'
  const tokenHash = hashWebhookToken(secretToken)
  assert.equal(verifyWebhookTokenHash(secretToken, tokenHash), true)
  assert.equal(verifyWebhookTokenHash('forged-token', tokenHash), false)
  assert.equal(verifyWebhookTokenHash('', tokenHash), false)

  const stubAdapter: GoogleCalendarAdapter = {
    refreshAccessToken: async () => ({ accessToken: 'tok', expiresIn: 3600 }),
    revokeToken: async () => undefined,
    listCalendars: async () => [],
    listEvents: async () => ({ items: [] }),
    listEventInstances: async () => [],
    insertEvent: async () => {
      throw new Error('Not expected')
    },
    updateEvent: async () => {
      throw new Error('Not expected')
    },
    deleteEvent: async () => undefined,
  }
  const tokenManager = new GoogleTokenManager(stubAdapter)
  const watchManager = new GoogleWatchChannelManager(
    stubAdapter,
    tokenManager,
    'https://api.edutracksystem.site/api/v1/calendar/google/webhook',
  )

  const now = new Date('2026-11-28T10:00:00Z')
  const withActiveWatch = {
    watchChannel: {
      channelId: 'ch-1',
      resourceId: 'res-1',
      tokenHash,
      expiration: new Date('2026-12-03T10:00:00Z'),
    },
  }
  const withoutWatch = { watchChannel: { channelId: '', resourceId: '', tokenHash: '', expiration: null } }

  assert.equal(
    watchManager.computeNextSyncAt(withActiveWatch, true, now).getTime() - now.getTime(),
    PASSIVE_FALLBACK_SYNC_INTERVAL_MS,
  )
  assert.equal(
    watchManager.computeNextSyncAt(withoutWatch, false, now).getTime() - now.getTime(),
    PASSIVE_FALLBACK_SYNC_INTERVAL_MS,
  )
  assert.equal(
    watchManager.computeNextSyncAt(withoutWatch, true, now).getTime() - now.getTime(),
    ONLINE_POLL_SYNC_INTERVAL_MS,
  )

  const userId = new Types.ObjectId()
  const integrationId = new Types.ObjectId()
  const calId = new Types.ObjectId()
  t.mock.method(googleCalendarRepository, 'findCalendarByWatchChannelId', async (chId: string) => {
    if (chId !== 'ch-1') return null
    return {
      _id: calId,
      userId,
      integrationId,
      isSelected: true,
      watchChannel: withActiveWatch.watchChannel,
    } as Awaited<ReturnType<typeof googleCalendarRepository.findCalendarByWatchChannelId>>
  })

  const syncPingOutcome = await watchManager.verifyWebhookNotification({
    channelId: 'ch-1',
    resourceId: 'res-1',
    resourceState: 'sync',
    channelToken: secretToken,
  })
  assert.deepEqual(syncPingOutcome, { action: 'ack_only' })

  const existsOutcome = await watchManager.verifyWebhookNotification({
    channelId: 'ch-1',
    resourceId: 'res-1',
    resourceState: 'exists',
    channelToken: secretToken,
  })
  assert.deepEqual(existsOutcome, {
    action: 'sync_calendar',
    userId: String(userId),
    integrationId: String(integrationId),
    calendarConnectionId: String(calId),
  })

  await assert.rejects(
    () =>
      watchManager.verifyWebhookNotification({
        channelId: 'ch-1',
        resourceId: 'res-1',
        resourceState: 'exists',
        channelToken: 'wrong-token',
      }),
    (err: unknown) =>
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'INVALID_WEBHOOK_SIGNATURE',
  )

  const hub = new GoogleSyncRealtimeHub()
  const receivedEvents: Array<{ name: string; reason: string }> = []
  const unsubscribe = hub.subscribe(String(userId), {
    id: 'sub-1',
    send: (eventName, payload) => {
      receivedEvents.push({ name: eventName, reason: payload.reason })
    },
  })
  assert.equal(hub.isUserOnline(String(userId)), true)
  hub.notifyUserSynced(String(userId), { reason: 'webhook', calendarConnectionId: String(calId) })
  assert.deepEqual(receivedEvents, [{ name: 'google-calendar-synced', reason: 'webhook' }])
  unsubscribe()
  assert.equal(hub.isUserOnline(String(userId)), false)
})
