import { randomUUID } from 'node:crypto'
import { AppError } from '@/shared/errors/app-error.js'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import {
  GoogleCalendarApiError,
  httpGoogleCalendarAdapter,
  type GoogleCalendarAdapter,
} from '@/modules/calendar/services/google-calendar.adapter.js'
import {
  toNormalizedSyncSnapshot,
  type SyncableConflictField,
} from '@/modules/calendar/services/google-calendar-mapper.js'
import { resolveGoogleCalendarOAuthConfig } from '@/modules/calendar/services/google-calendar-oauth.service.js'
import { GoogleInboundSyncProcessor } from '@/modules/calendar/services/google-inbound-sync.processor.js'
import { GoogleOutboundSyncProcessor } from '@/modules/calendar/services/google-outbound-sync.processor.js'
import {
  computeExponentialBackoffDelayMs,
  isReadOnlyForbiddenError,
  isRetryableRateOrServerError,
  isTokenRevokedError,
  MAX_AUTOMATIC_RETRIES,
  ONLINE_POLL_SYNC_INTERVAL_MS,
  PASSIVE_FALLBACK_SYNC_INTERVAL_MS,
  snapshotToDbRecord,
  WORKER_LEASE_MS,
  type ClaimedSyncJob,
  type GoogleSyncJobType,
} from '@/modules/calendar/services/google-sync-errors.js'
import {
  googleSyncRealtimeHub,
  type GoogleSyncRealtimeHub,
} from '@/modules/calendar/services/google-sync-realtime.hub.js'
import { GoogleTokenManager } from '@/modules/calendar/services/google-token.manager.js'
import {
  GoogleWatchChannelManager,
  type IncomingGoogleWebhookHeaders,
} from '@/modules/calendar/services/google-watch-channel.manager.js'
import { decryptToken } from '@/modules/calendar/services/token-crypto.js'
import type { GoogleCalendarAccessRole } from '@/modules/calendar/types/calendar.types.js'

export { computeExponentialBackoffDelayMs }

const MANUAL_SYNC_CONCURRENCY = 3
const MANUAL_WAIT_RUNNING_JOB_MS = 5_000
const MANUAL_WAIT_POLL_MS = 150

const DEFAULT_CONFLICT_FIELDS: readonly SyncableConflictField[] = [
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

const serializeConflictVersion = (raw: {
  title: string
  description?: string
  startDate: Date
  endDate: Date
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  availability?: 'busy' | 'free'
  visibility?: 'default' | 'public' | 'private'
  timeZone?: string
  recurrence?: {
    frequency?: string
    interval?: number
    daysOfWeek?: number[]
    until?: Date | null
    count?: number | null
  } | null
  etag?: string
  updatedAt: Date
}) => ({
  title: raw.title,
  description: raw.description ?? '',
  startDate: raw.startDate.toISOString(),
  endDate: raw.endDate.toISOString(),
  isAllDay: Boolean(raw.isAllDay),
  location: raw.location ?? '',
  onlineMeetingUrl: raw.onlineMeetingUrl ?? '',
  availability: raw.availability ?? 'busy',
  visibility: raw.visibility ?? 'default',
  timeZone: raw.timeZone ?? '',
  recurrence: raw.recurrence
    ? {
        frequency: raw.recurrence.frequency ?? 'none',
        interval: raw.recurrence.interval ?? 1,
        daysOfWeek: raw.recurrence.daysOfWeek ?? [],
        until: raw.recurrence.until ? raw.recurrence.until.toISOString() : null,
        count: raw.recurrence.count ?? null,
      }
    : undefined,
  etag: raw.etag ?? '',
  updatedAt: raw.updatedAt.toISOString(),
})

export class GoogleCalendarSyncService {
  private readonly tokenManager: GoogleTokenManager
  private readonly watchManager: GoogleWatchChannelManager
  private readonly inboundProcessor: GoogleInboundSyncProcessor
  private readonly outboundProcessor: GoogleOutboundSyncProcessor
  private readonly realtimeHub: GoogleSyncRealtimeHub
  private readonly jobExecutors: Readonly<
    Record<GoogleSyncJobType, (job: ClaimedSyncJob, workerId: string) => Promise<void>>
  >

  public constructor(
    private readonly adapter: GoogleCalendarAdapter = httpGoogleCalendarAdapter,
    options?: {
      realtimeHub?: GoogleSyncRealtimeHub
      webhookUrlOverride?: string
    },
  ) {
    this.realtimeHub = options?.realtimeHub ?? googleSyncRealtimeHub
    this.tokenManager = new GoogleTokenManager(this.adapter)
    this.watchManager = new GoogleWatchChannelManager(
      this.adapter,
      this.tokenManager,
      options?.webhookUrlOverride,
    )
    this.inboundProcessor = new GoogleInboundSyncProcessor(
      this.adapter,
      this.tokenManager,
      this.watchManager,
      this.realtimeHub,
    )
    this.outboundProcessor = new GoogleOutboundSyncProcessor(this.adapter, this.tokenManager)
    this.jobExecutors = {
      full_sync: (job, workerId) => this.inboundProcessor.executeFullSyncJob(job, workerId),
      incremental_sync: (job, workerId) =>
        this.inboundProcessor.executeIncrementalSyncJob(job, workerId),
      event_push: (job) => this.outboundProcessor.executeEventPushJob(job),
      event_delete: (job) => this.outboundProcessor.executeEventDeleteJob(job),
      conflict_resolve: async (job) => {
        if (!job.conflictId) return
        await this.outboundProcessor.pushResolvedConflictToGoogle(
          String(job.userId),
          String(job.conflictId),
        )
      },
    }
  }

  public async listIntegrations(userId: string) {
    const isConfigured = Boolean(resolveGoogleCalendarOAuthConfig())
    const [integrations, calendars, conflicts, jobs] = await Promise.all([
      googleCalendarRepository.findIntegrationsByUserId(userId),
      googleCalendarRepository.findCalendarsByUserId(userId),
      googleCalendarRepository.findPendingConflictsByUserId(userId),
      googleCalendarRepository.findJobsByUserId(userId),
    ])

    const calendarsByIntegration = new Map<string, typeof calendars>()
    for (const cal of calendars) {
      const key = String(cal.integrationId)
      const list = calendarsByIntegration.get(key) ?? []
      list.push(cal)
      calendarsByIntegration.set(key, list)
    }

    const conflictsCountByIntegration = new Map<string, number>()
    for (const conflict of conflicts) {
      const key = conflict.integrationId ? String(conflict.integrationId) : ''
      if (key) {
        conflictsCountByIntegration.set(key, (conflictsCountByIntegration.get(key) ?? 0) + 1)
      }
    }

    const mappedIntegrations = integrations.map((integration) => {
      const id = String(integration._id)
      const ownedCalendars = (calendarsByIntegration.get(id) ?? []).map((cal) => ({
        id: String(cal._id),
        integrationId: id,
        googleCalendarId: cal.googleCalendarId,
        summary: cal.summary,
        description: cal.description,
        backgroundColor: cal.backgroundColor,
        foregroundColor: cal.foregroundColor,
        timeZone: cal.timeZone,
        accessRole: cal.accessRole as GoogleCalendarAccessRole,
        isPrimary: Boolean(cal.isPrimary),
        isSelected: Boolean(cal.isSelected),
        isVisible: Boolean(cal.isVisible),
        syncStatus: cal.syncStatus,
        fullSyncProgress: {
          syncedCount: cal.fullSyncCheckpoint?.syncedCount ?? 0,
          pagesProcessed: cal.fullSyncCheckpoint?.pagesProcessed ?? 0,
          completedAt: cal.fullSyncCheckpoint?.completedAt
            ? cal.fullSyncCheckpoint.completedAt.toISOString()
            : null,
        },
        lastSyncedAt: cal.lastSyncedAt ? cal.lastSyncedAt.toISOString() : null,
        nextSyncAt: cal.nextSyncAt ? cal.nextSyncAt.toISOString() : null,
        lastSyncError: cal.lastSyncError || '',
      }))

      return {
        id,
        googleSub: integration.googleSub,
        googleEmail: integration.googleEmail,
        displayName: integration.displayName,
        avatarUrl: integration.avatarUrl,
        status: integration.status,
        isPrimarySyncAccount: Boolean(integration.isPrimarySyncAccount),
        syncToGoogleEnabled: Boolean(integration.syncToGoogleEnabled),
        syncFromGoogleEnabled: Boolean(integration.syncFromGoogleEnabled),
        lastSyncedAt: integration.lastSyncedAt ? integration.lastSyncedAt.toISOString() : null,
        lastError: integration.lastError || '',
        pendingConflictsCount: conflictsCountByIntegration.get(id) ?? 0,
        calendars: ownedCalendars,
      }
    })

    const mappedJobs = jobs.map((job) => ({
      id: String(job._id),
      integrationId: String(job.integrationId),
      calendarConnectionId: job.calendarConnectionId ? String(job.calendarConnectionId) : null,
      eventId: job.eventId ? String(job.eventId) : null,
      jobType: job.jobType,
      status: job.status,
      retriesUsed: job.retriesUsed,
      maxRetries: job.maxRetries,
      nextRetryAt: job.nextRetryAt ? job.nextRetryAt.toISOString() : null,
      lastErrorCode: job.lastErrorCode || '',
      lastErrorMessage: job.lastErrorMessage || '',
      updatedAt: job.updatedAt ? job.updatedAt.toISOString() : new Date().toISOString(),
    }))

    return {
      isConfigured,
      integrations: mappedIntegrations,
      jobs: mappedJobs,
    }
  }

  public async updateIntegrationSettings(
    userId: string,
    integrationId: string,
    input: unknown,
  ) {
    const existing = await googleCalendarRepository.findIntegrationById(userId, integrationId)
    if (!existing) {
      throw new AppError(
        404,
        'GOOGLE_INTEGRATION_NOT_FOUND',
        'Không tìm thấy tài khoản Google đã liên kết.',
      )
    }

    const data = (typeof input === 'object' && input !== null ? input : {}) as Record<
      string,
      unknown
    >
    const fields: Record<string, unknown> = {}

    if (typeof data.syncToGoogleEnabled === 'boolean') {
      fields.syncToGoogleEnabled = data.syncToGoogleEnabled
    }
    if (typeof data.syncFromGoogleEnabled === 'boolean') {
      fields.syncFromGoogleEnabled = data.syncFromGoogleEnabled
    }

    if (Object.keys(fields).length > 0) {
      await googleCalendarRepository.updateIntegrationById(userId, integrationId, fields)
    }

    if (data.isPrimarySyncAccount === true) {
      await googleCalendarRepository.setPrimarySyncAccount(userId, integrationId)
    }

    return this.listIntegrations(userId)
  }

  public async refreshCalendarsForIntegration(userId: string, integrationId: string) {
    try {
      const items = await this.tokenManager.withValidToken(
        userId,
        integrationId,
        (accessToken) => this.adapter.listCalendars(accessToken),
      )
      await googleCalendarRepository.upsertCalendarsFromGoogle(userId, integrationId, items)
    } catch (error: unknown) {
      if (error instanceof AppError) throw error
      throw new AppError(
        502,
        'GOOGLE_CALENDAR_LIST_FAILED',
        'Không thể tải danh sách lịch từ Google. Vui lòng thử lại.',
      )
    }
    return this.listIntegrations(userId)
  }

  public async updateCalendarSelection(
    userId: string,
    integrationId: string,
    input: unknown,
  ) {
    const integration = await googleCalendarRepository.findIntegrationById(userId, integrationId)
    if (!integration) {
      throw new AppError(
        404,
        'GOOGLE_INTEGRATION_NOT_FOUND',
        'Không tìm thấy tài khoản Google đã liên kết.',
      )
    }

    const { selectedSet, removalActionMap } = this.parseCalendarSelectionInput(input)
    const ownedCalendars = await googleCalendarRepository.findCalendarsByIntegrationId(
      userId,
      integrationId,
    )

    this.validateRequiredRemovalActions(ownedCalendars, selectedSet, removalActionMap)

    for (const cal of ownedCalendars) {
      const calId = String(cal._id)
      const nowSelected = selectedSet.has(calId)

      if (!cal.isSelected && nowSelected) {
        await this.activateNewlySelectedCalendar(userId, integrationId, calId)
        continue
      }

      if (cal.isSelected && !nowSelected) {
        const action = removalActionMap.get(calId) ?? 'keep'
        await this.deactivateUnselectedCalendar(userId, integrationId, cal, action)
      }
    }

    return this.listIntegrations(userId)
  }

  public async updateCalendarVisibility(
    userId: string,
    calendarConnectionId: string,
    isVisible: boolean,
  ) {
    const calendar = await googleCalendarRepository.findCalendarById(
      userId,
      calendarConnectionId,
    )
    if (!calendar) {
      throw new AppError(404, 'GOOGLE_CALENDAR_NOT_FOUND', 'Không tìm thấy lịch Google yêu cầu.')
    }
    await googleCalendarRepository.updateCalendarById(calendarConnectionId, { isVisible })
    return this.listIntegrations(userId)
  }

  public async triggerCalendarSync(userId: string, calendarConnectionId: string) {
    const calendar = await googleCalendarRepository.findCalendarById(
      userId,
      calendarConnectionId,
    )
    if (!calendar) {
      throw new AppError(404, 'GOOGLE_CALENDAR_NOT_FOUND', 'Không tìm thấy lịch Google yêu cầu.')
    }
    if (!calendar.isSelected) {
      throw new AppError(400, 'CALENDAR_NOT_SELECTED', 'Lịch này chưa được chọn để đồng bộ.')
    }

    const integrationId = String(calendar.integrationId)
    const integration = await googleCalendarRepository.findIntegrationById(userId, integrationId)
    if (!integration || integration.status !== 'connected') {
      throw new AppError(
        401,
        'GOOGLE_CALENDAR_REAUTH_REQUIRED',
        'Tài khoản Google này cần được liên kết lại trước khi đồng bộ.',
      )
    }

    await this.tokenManager.refreshCalendarsMetadataSafe(userId, integrationId)
    const refreshedCalendar = await googleCalendarRepository.findCalendarById(
      userId,
      calendarConnectionId,
    )
    const activeCal = refreshedCalendar ?? calendar
    const needsFullSync = this.requiresFullSync(activeCal)

    if (needsFullSync || !integration.syncFromGoogleEnabled) {
      await googleCalendarRepository.enqueueJob({
        userId,
        integrationId,
        calendarConnectionId,
        jobType: needsFullSync ? 'full_sync' : 'incremental_sync',
      })
      return this.listIntegrations(userId)
    }

    await this.runImmediateIncrementalCalendarSync(userId, integrationId, calendarConnectionId)
    return this.listIntegrations(userId)
  }

  public async triggerIntegrationSync(userId: string, integrationId: string) {
    const integration = await googleCalendarRepository.findIntegrationById(userId, integrationId)
    if (!integration) {
      throw new AppError(
        404,
        'GOOGLE_INTEGRATION_NOT_FOUND',
        'Không tìm thấy tài khoản Google đã liên kết.',
      )
    }
    if (integration.status !== 'connected') {
      throw new AppError(
        401,
        'GOOGLE_CALENDAR_REAUTH_REQUIRED',
        'Tài khoản Google này đã hết hạn hoặc bị thu hồi quyền. Vui lòng liên kết lại.',
      )
    }

    await this.tokenManager.refreshCalendarsMetadataSafe(userId, integrationId)

    const calendars = await googleCalendarRepository.findCalendarsByIntegrationId(
      userId,
      integrationId,
    )
    const immediateCalendarIds: string[] = []

    for (const cal of calendars) {
      if (!cal.isSelected) continue
      const calId = String(cal._id)
      const needsFullSync = this.requiresFullSync(cal)

      if (needsFullSync || !integration.syncFromGoogleEnabled) {
        await googleCalendarRepository.enqueueJob({
          userId,
          integrationId,
          calendarConnectionId: calId,
          jobType: needsFullSync ? 'full_sync' : 'incremental_sync',
        })
        continue
      }

      immediateCalendarIds.push(calId)
    }

    for (let index = 0; index < immediateCalendarIds.length; index += MANUAL_SYNC_CONCURRENCY) {
      const batch = immediateCalendarIds.slice(index, index + MANUAL_SYNC_CONCURRENCY)
      await Promise.allSettled(
        batch.map((calId) =>
          this.runImmediateIncrementalCalendarSync(userId, integrationId, calId),
        ),
      )
    }

    return this.listIntegrations(userId)
  }

  public async handleWebhookNotification(headers: IncomingGoogleWebhookHeaders): Promise<void> {
    const verified = await this.watchManager.verifyWebhookNotification(headers)
    if (verified.action === 'ack_only') return

    void this.runImmediateIncrementalCalendarSync(
      verified.userId,
      verified.integrationId,
      verified.calendarConnectionId,
    )
      .then(() => {
        this.realtimeHub.notifyUserSynced(verified.userId, {
          reason: 'webhook',
          calendarConnectionId: verified.calendarConnectionId,
        })
      })
      .catch((error: unknown) => {
        console.error(
          '[GoogleCalendarWebhook] Sync execution error:',
          error instanceof Error ? error.message : 'Unknown error',
        )
      })
  }

  public async onUserRealtimeConnected(userId: string): Promise<void> {
    const [integrations, calendars] = await Promise.all([
      googleCalendarRepository.findIntegrationsByUserId(userId),
      googleCalendarRepository.findCalendarsByUserId(userId),
    ])

    const connectedMap = new Map(
      integrations
        .filter((item) => item.status === 'connected' && item.syncFromGoogleEnabled)
        .map((item) => [String(item._id), item]),
    )
    if (connectedMap.size === 0) return

    const now = new Date()
    for (const cal of calendars) {
      const integrationId = String(cal.integrationId)
      if (!cal.isSelected || cal.syncStatus !== 'active' || !connectedMap.has(integrationId)) {
        continue
      }
      if (this.watchManager.hasActiveWatchChannel(cal, now)) continue

      const lastSyncedMs = cal.lastSyncedAt ? cal.lastSyncedAt.getTime() : 0
      const isOverdueForOnlineSession =
        now.getTime() - lastSyncedMs >= ONLINE_POLL_SYNC_INTERVAL_MS

      if (isOverdueForOnlineSession) {
        await googleCalendarRepository.enqueueJob({
          userId,
          integrationId,
          calendarConnectionId: String(cal._id),
          jobType: 'incremental_sync',
        })
        continue
      }

      const nextOnlineDue = new Date(lastSyncedMs + ONLINE_POLL_SYNC_INTERVAL_MS)
      if (!cal.nextSyncAt || cal.nextSyncAt.getTime() > nextOnlineDue.getTime()) {
        await googleCalendarRepository.updateCalendarById(String(cal._id), {
          nextSyncAt: nextOnlineDue,
        })
      }
    }
  }

  public async unlinkIntegration(userId: string, integrationId: string) {
    const integration = await googleCalendarRepository.findIntegrationById(
      userId,
      integrationId,
      true,
    )
    if (!integration) {
      throw new AppError(
        404,
        'GOOGLE_INTEGRATION_NOT_FOUND',
        'Không tìm thấy tài khoản Google đã liên kết.',
      )
    }

    await googleCalendarRepository.cancelPendingJobsForIntegration(userId, integrationId)

    const refreshToken = decryptToken(integration.encryptedRefreshToken ?? '')
    const accessToken = decryptToken(integration.encryptedAccessToken ?? '')
    await this.watchManager.stopAllWatchChannelsForIntegration(userId, integrationId, accessToken)

    if (refreshToken || accessToken) {
      await this.adapter.revokeToken(refreshToken || accessToken)
    }

    await googleCalendarRepository.deleteConflictsByIntegrationId(userId, integrationId)
    await googleCalendarRepository.deleteMappingsByIntegrationId(userId, integrationId)
    await googleCalendarRepository.deleteCalendarsByIntegrationId(userId, integrationId)
    await googleCalendarRepository.deleteIntegrationById(userId, integrationId)
    await googleCalendarRepository.ensureFallbackPrimaryAccount(userId)

    return this.listIntegrations(userId)
  }

  public async enqueueLocalEventPush(userId: string, eventId: string): Promise<void> {
    await this.outboundProcessor.enqueueLocalEventPush(userId, eventId)
  }

  public async enqueueDetachedGoogleEventPush(
    userId: string,
    sourceEventId: string,
    newEventId: string,
  ): Promise<void> {
    await this.outboundProcessor.enqueueDetachedGoogleEventPush(
      userId,
      sourceEventId,
      newEventId,
    )
  }

  public async enqueueLocalEventDelete(
    userId: string,
    eventId: string,
    scope: 'local_only' | 'both',
  ): Promise<void> {
    await this.outboundProcessor.enqueueLocalEventDelete(userId, eventId, scope)
  }

  public async listPendingConflicts(userId: string) {
    const [conflicts, integrations, calendars] = await Promise.all([
      googleCalendarRepository.findPendingConflictsByUserId(userId),
      googleCalendarRepository.findIntegrationsByUserId(userId),
      googleCalendarRepository.findCalendarsByUserId(userId),
    ])

    const integrationById = new Map(integrations.map((i) => [String(i._id), i]))
    const calendarById = new Map(calendars.map((c) => [String(c._id), c]))

    return conflicts.map((item) => {
      const integ = item.integrationId ? integrationById.get(String(item.integrationId)) : undefined
      const cal = item.calendarConnectionId
        ? calendarById.get(String(item.calendarConnectionId))
        : undefined
      return {
        id: String(item._id),
        eventId: String(item.eventId),
        integrationId: item.integrationId ? String(item.integrationId) : null,
        calendarConnectionId: item.calendarConnectionId
          ? String(item.calendarConnectionId)
          : null,
        accountEmail: integ?.googleEmail ?? '',
        calendarName: cal?.summary ?? '',
        googleEventId: item.googleEventId,
        conflictedFields: item.conflictedFields ?? [],
        status: item.status,
        baseVersion: item.baseVersion ? serializeConflictVersion(item.baseVersion) : undefined,
        localVersion: serializeConflictVersion(item.localVersion),
        googleVersion: serializeConflictVersion(item.googleVersion),
        createdAt: item.createdAt ? item.createdAt.toISOString() : new Date().toISOString(),
      }
    })
  }

  public async resolveConflict(
    userId: string,
    conflictId: string,
    input: {
      choice?: 'local' | 'google'
      fieldChoices?: Record<string, 'local' | 'google'>
    },
  ): Promise<void> {
    const conflict = await googleCalendarRepository.findConflictById(userId, conflictId)
    if (!conflict) {
      throw new AppError(404, 'CONFLICT_NOT_FOUND', 'Không tìm thấy xung đột cần xử lý.')
    }

    const event = await googleCalendarRepository.findEventById(userId, String(conflict.eventId))
    if (!event) {
      await googleCalendarRepository.updateConflictById(conflictId, {
        status: 'resolved_google',
        resolvedAt: new Date(),
      })
      return
    }

    if (
      conflict.localExpectedUpdatedAt &&
      event.updatedAt.getTime() > conflict.localExpectedUpdatedAt.getTime() + 1000
    ) {
      await googleCalendarRepository.updateConflictById(conflictId, {
        localVersion: snapshotToDbRecord(toNormalizedSyncSnapshot(event)),
        localExpectedUpdatedAt: event.updatedAt,
      })
      throw new AppError(
        409,
        'CONFLICT_VERSION_CHANGED',
        'Sự kiện trên EduTrack đã thay đổi trong lúc xử lý xung đột. Vui lòng xem lại dữ liệu mới nhất.',
      )
    }

    const resolvedFields = this.buildConflictFieldChoices(conflict.conflictedFields, input)
    const localSnap = toNormalizedSyncSnapshot(event)
    const remoteSnap = toNormalizedSyncSnapshot(conflict.googleVersion)
    const mergedUpdate: Record<string, unknown> = {}

    for (const [field, pick] of resolvedFields.entries()) {
      mergedUpdate[field] =
        pick === 'local'
          ? localSnap[field as SyncableConflictField]
          : remoteSnap[field as SyncableConflictField]
    }

    await googleCalendarRepository.updateSyncedEvent(userId, event._id, mergedUpdate)
    await googleCalendarRepository.updateConflictById(conflictId, {
      status: 'resolution_pending',
      fieldChoices: Object.fromEntries(resolvedFields),
    })

    if (conflict.mappingId) {
      await googleCalendarRepository.updateMappingById(conflict.mappingId, {
        status: 'resolution_pending',
      })
    }

    const integrationId = conflict.integrationId ? String(conflict.integrationId) : ''
    const calendarConnectionId = conflict.calendarConnectionId
      ? String(conflict.calendarConnectionId)
      : ''
    if (!integrationId || !calendarConnectionId || !conflict.mappingId) {
      throw new AppError(
        400,
        'CONFLICT_MAPPING_MISSING',
        'Thiếu thông tin mapping để đồng bộ lựa chọn.',
      )
    }

    await this.outboundProcessor.pushResolvedConflictToGoogle(userId, conflictId)
  }

  public async retryJobManually(userId: string, jobId: string) {
    const job = await googleCalendarRepository.findJobByIdForUser(userId, jobId)
    if (!job) {
      throw new AppError(404, 'SYNC_JOB_NOT_FOUND', 'Không tìm thấy tác vụ đồng bộ yêu cầu.')
    }
    if (job.status === 'completed' || job.status === 'cancelled') {
      throw new AppError(
        400,
        'SYNC_JOB_NOT_RETRYABLE',
        'Không thể chạy lại tác vụ đã hoàn tất hoặc đã hủy.',
      )
    }
    if (job.status === 'pending' || job.status === 'running' || job.status === 'retry_wait') {
      throw new AppError(
        409,
        'SYNC_JOB_ALREADY_ACTIVE',
        'Tác vụ này hiện đang chạy hoặc đang chờ thử lại.',
      )
    }

    const integration = await googleCalendarRepository.findIntegrationById(
      userId,
      String(job.integrationId),
    )
    if (!integration || integration.status !== 'connected') {
      throw new AppError(
        401,
        'GOOGLE_CALENDAR_REAUTH_REQUIRED',
        'Tài khoản Google này cần được liên kết lại trước khi thử lại tác vụ.',
      )
    }

    await googleCalendarRepository.updateJobById(job._id, {
      status: 'pending',
      retriesUsed: 0,
      nextRetryAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: '',
      lastErrorMessage: '',
    })

    return this.listIntegrations(userId)
  }

  public async scheduleDueIncrementalSyncs(): Promise<void> {
    await this.watchManager.renewDueWatchChannels()

    const now = new Date()
    const dueCalendars =
      await googleCalendarRepository.findDueActiveCalendarsForIncrementalSync(now)

    for (const cal of dueCalendars) {
      const userId = String(cal.userId)
      const integrationId = String(cal.integrationId)
      const integration = await googleCalendarRepository.findIntegrationById(
        userId,
        integrationId,
      )
      if (
        !integration ||
        integration.status !== 'connected' ||
        !integration.syncFromGoogleEnabled
      ) {
        continue
      }

      const hasWebhook = this.watchManager.hasActiveWatchChannel(cal, now)
      const isUserOnline = this.realtimeHub.isUserOnline(userId)
      const lastSyncedMs = cal.lastSyncedAt ? cal.lastSyncedAt.getTime() : 0
      const isWithinPassiveWindow =
        lastSyncedMs > 0 && now.getTime() - lastSyncedMs < PASSIVE_FALLBACK_SYNC_INTERVAL_MS

      if ((hasWebhook || !isUserOnline) && isWithinPassiveWindow) {
        await googleCalendarRepository.updateCalendarById(String(cal._id), {
          nextSyncAt: new Date(lastSyncedMs + PASSIVE_FALLBACK_SYNC_INTERVAL_MS),
        })
        continue
      }

      await googleCalendarRepository.enqueueJob({
        userId,
        integrationId,
        calendarConnectionId: String(cal._id),
        jobType: 'incremental_sync',
      })
    }
  }

  public async processClaimedJob(jobId: unknown, workerId: string): Promise<void> {
    const job = await googleCalendarRepository.findJobById(jobId)
    if (!job || job.status !== 'running' || job.leaseOwner !== workerId) return

    const userId = String(job.userId)
    const integrationId = String(job.integrationId)
    const startedAt = new Date()
    const attemptNumber = (job.attemptHistory?.length ?? 0) + 1
    const triggerType: 'auto' | 'manual' =
      job.retriesUsed === 0 && attemptNumber > 1 ? 'manual' : 'auto'

    try {
      const integration = await googleCalendarRepository.findIntegrationById(
        userId,
        integrationId,
      )
      if (!integration || integration.status !== 'connected') {
        await googleCalendarRepository.updateJobById(job._id, {
          status: 'cancelled',
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: 'GOOGLE_CALENDAR_REAUTH_REQUIRED',
          lastErrorMessage: 'Tài khoản Google không ở trạng thái kết nối.',
        })
        return
      }

      const executor = this.jobExecutors[job.jobType as GoogleSyncJobType]
      if (executor) {
        await executor(job, workerId)
      }

      await googleCalendarRepository.updateJobById(job._id, {
        status: 'completed',
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: '',
        lastErrorMessage: '',
        attemptHistory: [
          ...(job.attemptHistory ?? []),
          {
            attemptNumber,
            triggerType,
            startedAt,
            finishedAt: new Date(),
            errorCode: '',
            errorMessage: '',
            retryAfterMs: null,
          },
        ],
      })
    } catch (error: unknown) {
      await this.handleJobFailure(job, error, attemptNumber, triggerType, startedAt)
    }
  }

  private requiresFullSync(calendar: { syncStatus?: string; syncToken?: string }): boolean {
    return (
      calendar.syncStatus === 'initial_sync_pending' ||
      calendar.syncStatus === 'initial_sync_failed' ||
      !calendar.syncToken
    )
  }

  private async runImmediateIncrementalCalendarSync(
    userId: string,
    integrationId: string,
    calendarConnectionId: string,
  ): Promise<void> {
    await googleCalendarRepository.enqueueJob({
      userId,
      integrationId,
      calendarConnectionId,
      jobType: 'incremental_sync',
    })

    const manualWorkerId = `manual-${randomUUID().slice(0, 8)}`
    const claimed = await googleCalendarRepository.claimActiveJobForCalendar(
      calendarConnectionId,
      'incremental_sync',
      manualWorkerId,
      new Date(),
      WORKER_LEASE_MS,
    )

    if (claimed) {
      await this.processClaimedJob(claimed._id, manualWorkerId)
      return
    }

    const deadline = Date.now() + MANUAL_WAIT_RUNNING_JOB_MS
    while (Date.now() < deadline) {
      const stillRunning = await googleCalendarRepository.hasActiveRunningJobForCalendar(
        calendarConnectionId,
        'incremental_sync',
        new Date(),
      )
      if (!stillRunning) break
      await new Promise((resolve) => setTimeout(resolve, MANUAL_WAIT_POLL_MS))
    }
  }

  private parseCalendarSelectionInput(input: unknown): {
    selectedSet: Set<string>
    removalActionMap: Map<string, 'keep' | 'delete'>
  } {
    const data = (typeof input === 'object' && input !== null ? input : {}) as Record<
      string,
      unknown
    >
    const rawSelectedIds = Array.isArray(data.selectedCalendarIds)
      ? data.selectedCalendarIds
      : null
    if (!rawSelectedIds || !rawSelectedIds.every((id) => typeof id === 'string')) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Danh sách lịch được chọn không hợp lệ.')
    }

    const removalActionMap = new Map<string, 'keep' | 'delete'>()
    const rawRemovedActions = Array.isArray(data.removedActions) ? data.removedActions : []
    for (const entry of rawRemovedActions) {
      if (typeof entry !== 'object' || entry === null) continue
      const rec = entry as Record<string, unknown>
      if (
        typeof rec.calendarConnectionId === 'string' &&
        (rec.action === 'keep' || rec.action === 'delete')
      ) {
        removalActionMap.set(rec.calendarConnectionId, rec.action)
      }
    }

    return { selectedSet: new Set(rawSelectedIds), removalActionMap }
  }

  private validateRequiredRemovalActions(
    ownedCalendars: Array<{ _id: unknown; isSelected?: boolean; summary?: string }>,
    selectedSet: Set<string>,
    removalActionMap: Map<string, 'keep' | 'delete'>,
  ): void {
    const missing = ownedCalendars.find(
      (cal) =>
        cal.isSelected &&
        !selectedSet.has(String(cal._id)) &&
        !removalActionMap.has(String(cal._id)),
    )
    if (!missing) return

    throw new AppError(
      400,
      'CALENDAR_REMOVAL_ACTION_REQUIRED',
      `Vui lòng chọn giữ lại hoặc xóa các sự kiện đã nhập từ lịch "${missing.summary ?? ''}" trước khi bỏ chọn.`,
    )
  }

  private async activateNewlySelectedCalendar(
    userId: string,
    integrationId: string,
    calendarConnectionId: string,
  ): Promise<void> {
    await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
      isSelected: true,
      isVisible: true,
      syncStatus: 'initial_sync_pending',
      syncToken: '',
      lastSyncError: '',
      lastSyncErrorCode: '',
      fullSyncCheckpoint: {
        nextPageToken: '',
        syncedCount: 0,
        pagesProcessed: 0,
        startedAt: null,
        completedAt: null,
      },
    })
    await googleCalendarRepository.enqueueJob({
      userId,
      integrationId,
      calendarConnectionId,
      jobType: 'full_sync',
    })
  }

  private async deactivateUnselectedCalendar(
    userId: string,
    integrationId: string,
    calendar: {
      _id: unknown
      watchChannel?: { channelId?: string; resourceId?: string } | null
    },
    action: 'keep' | 'delete',
  ): Promise<void> {
    const calId = String(calendar._id)
    await this.watchManager.stopWatchChannelForCalendar(userId, integrationId, calendar)
    await googleCalendarRepository.cancelPendingJobsForCalendar(userId, calId)
    await googleCalendarRepository.deleteConflictsByCalendarId(userId, calId)
    await googleCalendarRepository.updateCalendarById(calId, {
      isSelected: false,
      syncStatus: 'unselected',
      syncToken: '',
      nextSyncAt: null,
      lastSyncError: '',
      lastSyncErrorCode: '',
    })

    const mappings = await googleCalendarRepository.findMappingsByCalendarId(userId, calId)
    for (const mapping of mappings) {
      if (action === 'delete') {
        await this.deleteImportedEventIfUnshared(userId, calId, mapping.eduTrackEventId)
      }
      await googleCalendarRepository.deleteMappingById(mapping._id)
    }
  }

  private async deleteImportedEventIfUnshared(
    userId: string,
    calendarConnectionId: string,
    eduTrackEventId: unknown,
  ): Promise<void> {
    const otherMappingsCount =
      await googleCalendarRepository.countActiveMappingsForEventExcludingCalendar(
        String(eduTrackEventId),
        calendarConnectionId,
      )
    if (otherMappingsCount > 0) return

    const localEvent = await googleCalendarRepository.findEventById(
      userId,
      String(eduTrackEventId),
    )
    if (localEvent && localEvent.syncOrigin === 'google') {
      await googleCalendarRepository.deleteSyncedEvent(userId, localEvent._id)
    }
  }

  private buildConflictFieldChoices(
    conflictedFields: string[] | undefined,
    input: {
      choice?: 'local' | 'google'
      fieldChoices?: Record<string, 'local' | 'google'>
    },
  ): Map<string, 'local' | 'google'> {
    const targetFields =
      conflictedFields && conflictedFields.length > 0
        ? conflictedFields
        : DEFAULT_CONFLICT_FIELDS
    const resolvedFields = new Map<string, 'local' | 'google'>()

    for (const field of targetFields) {
      const explicitChoice = input.fieldChoices?.[field] ?? input.choice
      if (explicitChoice !== 'local' && explicitChoice !== 'google') {
        throw new AppError(
          422,
          'VALIDATION_ERROR',
          'Vui lòng chọn giá trị ưu tiên cho tất cả các trường xung đột.',
        )
      }
      resolvedFields.set(field, explicitChoice)
    }

    return resolvedFields
  }

  private async handleJobFailure(
    job: ClaimedSyncJob,
    error: unknown,
    attemptNumber: number,
    triggerType: 'auto' | 'manual',
    startedAt: Date,
  ): Promise<void> {
    const userId = String(job.userId)
    const integrationId = String(job.integrationId)
    const errorCode =
      error instanceof AppError
        ? error.code
        : error instanceof GoogleCalendarApiError
          ? `GOOGLE_HTTP_${error.status}`
          : 'GOOGLE_CALENDAR_SYNC_FAILED'
    const errorMessage =
      error instanceof Error ? error.message : 'Lỗi đồng bộ Google Lịch không xác định.'

    const isReauth =
      errorCode === 'GOOGLE_CALENDAR_REAUTH_REQUIRED' || isTokenRevokedError(error)
    const isPermanent400 = error instanceof GoogleCalendarApiError && error.status === 400
    const isPermanent403 = isReadOnlyForbiddenError(error)
    const retryAfterMs = error instanceof GoogleCalendarApiError ? error.retryAfterMs : undefined

    const canRetry =
      !isReauth &&
      !isPermanent400 &&
      !isPermanent403 &&
      isRetryableRateOrServerError(error) &&
      job.retriesUsed < (job.maxRetries ?? MAX_AUTOMATIC_RETRIES)

    const delayMs = canRetry
      ? computeExponentialBackoffDelayMs(job.retriesUsed, retryAfterMs)
      : null

    const historyEntry = {
      attemptNumber,
      triggerType,
      startedAt,
      finishedAt: new Date(),
      errorCode,
      errorMessage,
      retryAfterMs: delayMs,
    }

    if (canRetry && delayMs !== null) {
      await googleCalendarRepository.updateJobById(job._id, {
        status: 'retry_wait',
        retriesUsed: job.retriesUsed + 1,
        nextRetryAt: new Date(Date.now() + delayMs),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        attemptHistory: [...(job.attemptHistory ?? []), historyEntry],
      })
      return
    }

    await googleCalendarRepository.updateJobById(job._id, {
      status: 'failed',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      attemptHistory: [...(job.attemptHistory ?? []), historyEntry],
    })

    if (job.calendarConnectionId) {
      const nextCalendarStatus = job.jobType === 'full_sync' ? 'initial_sync_failed' : 'error'
      await googleCalendarRepository.updateCalendarById(String(job.calendarConnectionId), {
        syncStatus: nextCalendarStatus,
        lastSyncError: errorMessage,
        lastSyncErrorCode: errorCode,
      })
    }

    if (isReauth) {
      await this.tokenManager.markReconnectRequired(userId, integrationId, errorMessage)
    }
  }
}

export const googleCalendarSyncService = new GoogleCalendarSyncService()
