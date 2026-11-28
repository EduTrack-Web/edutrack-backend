import { Types } from 'mongoose'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import {
  GoogleCalendarApiError,
  type GoogleCalendarAdapter,
  type GoogleCalendarEventResource,
} from '@/modules/calendar/services/google-calendar.adapter.js'
import {
  computeThreeWaySyncDiff,
  googleEventToLocalFields,
  isGoogleEventEditable,
  toNormalizedSyncSnapshot,
} from '@/modules/calendar/services/google-calendar-mapper.js'
import {
  snapshotToDbRecord,
  WORKER_LEASE_MS,
  type ClaimedSyncJob,
} from '@/modules/calendar/services/google-sync-errors.js'
import type { GoogleSyncRealtimeHub } from '@/modules/calendar/services/google-sync-realtime.hub.js'
import type { GoogleTokenManager } from '@/modules/calendar/services/google-token.manager.js'
import type { GoogleWatchChannelManager } from '@/modules/calendar/services/google-watch-channel.manager.js'
import type { GoogleCalendarAccessRole } from '@/modules/calendar/types/calendar.types.js'

interface PulledItemContext {
  userId: string
  integration: { _id: unknown; googleEmail: string }
  calendar: {
    _id: unknown
    googleCalendarId: string
    summary: string
    backgroundColor: string
    timeZone: string
    accessRole: GoogleCalendarAccessRole
  }
  resource: GoogleCalendarEventResource
  colorPalette?: Readonly<Record<string, string>>
  eventLabelPalette?: Readonly<Record<string, string>>
}

type MappedLocalEventFromGoogle = NonNullable<ReturnType<typeof googleEventToLocalFields>>
type ExistingMappingDoc = Awaited<ReturnType<typeof googleCalendarRepository.findMappingByGoogleId>>
type ExistingLocalEventDoc = NonNullable<
  Awaited<ReturnType<typeof googleCalendarRepository.findEventById>>
>

export class GoogleInboundSyncProcessor {
  public constructor(
    private readonly adapter: GoogleCalendarAdapter,
    private readonly tokenManager: GoogleTokenManager,
    private readonly watchManager: GoogleWatchChannelManager,
    private readonly realtimeHub: GoogleSyncRealtimeHub,
  ) {}

  public async executeFullSyncJob(job: ClaimedSyncJob, workerId: string): Promise<void> {
    if (!job.calendarConnectionId) return
    const userId = String(job.userId)
    const integrationId = String(job.integrationId)
    const calendarConnectionId = String(job.calendarConnectionId)

    const [integration, calendar] = await Promise.all([
      googleCalendarRepository.findIntegrationById(userId, integrationId),
      googleCalendarRepository.findCalendarById(userId, calendarConnectionId),
    ])
    if (!integration || !calendar || !calendar.isSelected) return

    await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
      syncStatus: 'initial_sync_running',
      lastSyncError: '',
      lastSyncErrorCode: '',
      ...(calendar.fullSyncCheckpoint?.startedAt
        ? {}
        : { 'fullSyncCheckpoint.startedAt': new Date() }),
    })

    await this.tokenManager.refreshCalendarsMetadataSafe(userId, integrationId)
    const refreshedCal = await googleCalendarRepository.findCalendarById(
      userId,
      calendarConnectionId,
    )
    const effectiveCalendar = refreshedCal ?? calendar

    const [colorPalette, eventLabelPalette] = await Promise.all([
      this.tokenManager.fetchEventColorPaletteSafe(userId, integrationId),
      this.tokenManager.fetchCalendarEventLabelsSafe(
        userId,
        integrationId,
        effectiveCalendar.googleCalendarId,
      ),
    ])

    let pageToken: string | undefined =
      job.checkpoint?.nextPageToken || calendar.fullSyncCheckpoint?.nextPageToken || undefined
    let syncedCount =
      job.checkpoint?.processedCount ?? calendar.fullSyncCheckpoint?.syncedCount ?? 0
    let pagesProcessed = calendar.fullSyncCheckpoint?.pagesProcessed ?? 0
    let finalSyncToken = ''

    do {
      const stillEligible = await this.isCalendarStillSyncable(
        userId,
        integrationId,
        calendarConnectionId,
        false,
      )
      if (!stillEligible) return

      const page = await this.tokenManager.withValidToken(userId, integrationId, (accessToken) =>
        this.adapter.listEvents({
          accessToken,
          calendarId: calendar.googleCalendarId,
          ...(pageToken ? { pageToken } : {}),
          showDeleted: false,
        }),
      )

      for (const item of page.items) {
        if (item.eventType && item.eventType !== 'default') continue
        await this.applyPulledGoogleItem({
          userId,
          integration,
          calendar: effectiveCalendar,
          resource: item,
          colorPalette,
          eventLabelPalette,
        })
        syncedCount += 1
      }

      pagesProcessed += 1
      pageToken = page.nextPageToken
      if (page.nextSyncToken) {
        finalSyncToken = page.nextSyncToken
      }

      await this.persistFullSyncPageProgress(
        job._id,
        workerId,
        calendarConnectionId,
        pageToken,
        syncedCount,
        pagesProcessed,
      )
    } while (pageToken)

    await this.watchManager.ensureWatchChannel(userId, integrationId, calendarConnectionId)
    const latestCalendar = await googleCalendarRepository.findCalendarById(
      userId,
      calendarConnectionId,
    )
    const now = new Date()
    const nextSyncAt = this.watchManager.computeNextSyncAt(
      latestCalendar ?? effectiveCalendar,
      this.realtimeHub.isUserOnline(userId),
      now,
    )

    await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
      syncStatus: 'active',
      syncToken: finalSyncToken,
      lastSyncedAt: now,
      nextSyncAt,
      lastSyncError: '',
      lastSyncErrorCode: '',
      'fullSyncCheckpoint.nextPageToken': '',
      'fullSyncCheckpoint.completedAt': now,
    })
    await googleCalendarRepository.updateIntegrationById(userId, integrationId, {
      lastSyncedAt: now,
      lastError: '',
    })
    this.realtimeHub.notifyUserSynced(userId, { reason: 'worker', calendarConnectionId })
  }

  public async executeIncrementalSyncJob(job: ClaimedSyncJob, workerId: string): Promise<void> {
    if (!job.calendarConnectionId) return
    const userId = String(job.userId)
    const integrationId = String(job.integrationId)
    const calendarConnectionId = String(job.calendarConnectionId)

    const [integration, calendar] = await Promise.all([
      googleCalendarRepository.findIntegrationById(userId, integrationId),
      googleCalendarRepository.findCalendarById(userId, calendarConnectionId),
    ])
    if (
      !integration ||
      integration.status !== 'connected' ||
      !integration.syncFromGoogleEnabled ||
      !calendar ||
      !calendar.isSelected
    ) {
      return
    }

    if (calendar.syncStatus !== 'active' || !calendar.syncToken) {
      await this.resetToFullSync(userId, integrationId, calendarConnectionId)
      return
    }

    const [colorPalette, eventLabelPalette] = await Promise.all([
      this.tokenManager.fetchEventColorPaletteSafe(userId, integrationId),
      this.tokenManager.fetchCalendarEventLabelsSafe(
        userId,
        integrationId,
        calendar.googleCalendarId,
      ),
    ])

    let pageToken: string | undefined
    let nextSyncToken = ''
    let changedItemsCount = 0

    try {
      do {
        const stillEligible = await this.isCalendarStillSyncable(
          userId,
          integrationId,
          calendarConnectionId,
          true,
        )
        if (!stillEligible) return

        const page = await this.tokenManager.withValidToken(userId, integrationId, (accessToken) =>
          this.adapter.listEvents({
            accessToken,
            calendarId: calendar.googleCalendarId,
            syncToken: calendar.syncToken,
            ...(pageToken ? { pageToken } : {}),
            showDeleted: true,
          }),
        )

        const validAfterFetch = await this.isCalendarStillSyncable(
          userId,
          integrationId,
          calendarConnectionId,
          false,
        )
        if (!validAfterFetch) return

        for (const item of page.items) {
          if (item.eventType && item.eventType !== 'default') continue
          await this.applyPulledGoogleItem({
            userId,
            integration,
            calendar,
            resource: item,
            colorPalette,
            eventLabelPalette,
          })
          changedItemsCount += 1
        }

        pageToken = page.nextPageToken
        if (page.nextSyncToken) {
          nextSyncToken = page.nextSyncToken
        }
        await googleCalendarRepository.extendJobLease(job._id, workerId, WORKER_LEASE_MS)
      } while (pageToken)
    } catch (error: unknown) {
      if (this.isSyncTokenInvalidatedError(error, Boolean(calendar.syncToken))) {
        await this.resetToFullSync(userId, integrationId, calendarConnectionId)
        return
      }
      throw error
    }

    await this.watchManager.ensureWatchChannel(userId, integrationId, calendarConnectionId)
    const latestCalendar = await googleCalendarRepository.findCalendarById(
      userId,
      calendarConnectionId,
    )
    const now = new Date()
    const nextSyncAt = this.watchManager.computeNextSyncAt(
      latestCalendar ?? calendar,
      this.realtimeHub.isUserOnline(userId),
      now,
    )

    await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
      ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
      lastSyncedAt: now,
      nextSyncAt,
      lastSyncError: '',
      lastSyncErrorCode: '',
    })
    await googleCalendarRepository.updateIntegrationById(userId, integrationId, {
      lastSyncedAt: now,
      lastError: '',
    })

    if (changedItemsCount > 0) {
      this.realtimeHub.notifyUserSynced(userId, { reason: 'worker', calendarConnectionId })
    }
  }

  public async applyPulledGoogleItem(ctx: PulledItemContext): Promise<void> {
    const calendarConnectionId = String(ctx.calendar._id)
    const existingMapping = await googleCalendarRepository.findMappingByGoogleId(
      calendarConnectionId,
      ctx.resource.id,
    )

    if (this.isMappingLockedFromPull(existingMapping)) return

    if (ctx.resource.status === 'cancelled') {
      await this.handleCancelledRemoteItem(ctx, existingMapping)
      return
    }

    const mapped = googleEventToLocalFields(
      ctx.resource,
      ctx.calendar.timeZone,
      ctx.colorPalette,
      ctx.eventLabelPalette,
    )
    if (!mapped) return

    const canEdit = isGoogleEventEditable({
      accessRole: ctx.calendar.accessRole,
      resource: ctx.resource,
      accountEmail: ctx.integration.googleEmail,
    })
    const parentLocalEventId = await this.resolveRecurringParentId(ctx, mapped)

    if (!existingMapping) {
      await this.insertNewLocalSyncedEvent(ctx, mapped, canEdit, parentLocalEventId)
      return
    }

    const localEvent = await googleCalendarRepository.findEventById(
      ctx.userId,
      String(existingMapping.eduTrackEventId),
    )
    if (!localEvent) {
      await googleCalendarRepository.deleteMappingById(existingMapping._id)
      return
    }

    if (this.isMappingAwaitingConflict(existingMapping)) return

    if (!canEdit) {
      await this.overwriteReadOnlyLocalEvent(ctx, existingMapping, localEvent._id, mapped)
      return
    }

    await this.mergeEditableLocalEvent(ctx, existingMapping, localEvent, mapped)
  }

  private isMappingLockedFromPull(mapping: ExistingMappingDoc): boolean {
    return (
      mapping?.status === 'suppressed_local_delete' || mapping?.status === 'pending_delete'
    )
  }

  private isMappingAwaitingConflict(mapping: NonNullable<ExistingMappingDoc>): boolean {
    return mapping.status === 'conflict_pending' || mapping.status === 'resolution_pending'
  }

  private isSyncTokenInvalidatedError(error: unknown, hadSyncToken: boolean): boolean {
    if (!(error instanceof GoogleCalendarApiError)) return false
    return error.status === 410 || (error.status === 400 && hadSyncToken)
  }

  private async isCalendarStillSyncable(
    userId: string,
    integrationId: string,
    calendarConnectionId: string,
    requirePullEnabled: boolean,
  ): Promise<boolean> {
    const [calendar, integration] = await Promise.all([
      googleCalendarRepository.findCalendarById(userId, calendarConnectionId),
      googleCalendarRepository.findIntegrationById(userId, integrationId),
    ])
    if (!calendar || !calendar.isSelected) return false
    if (!integration || integration.status !== 'connected') return false
    return !requirePullEnabled || Boolean(integration.syncFromGoogleEnabled)
  }

  private async persistFullSyncPageProgress(
    jobId: unknown,
    workerId: string,
    calendarConnectionId: string,
    pageToken: string | undefined,
    syncedCount: number,
    pagesProcessed: number,
  ): Promise<void> {
    await googleCalendarRepository.updateJobById(jobId, {
      checkpoint: {
        nextPageToken: pageToken ?? '',
        processedCount: syncedCount,
      },
    })
    await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
      'fullSyncCheckpoint.nextPageToken': pageToken ?? '',
      'fullSyncCheckpoint.syncedCount': syncedCount,
      'fullSyncCheckpoint.pagesProcessed': pagesProcessed,
    })
    await googleCalendarRepository.extendJobLease(jobId, workerId, WORKER_LEASE_MS)
  }

  private async resetToFullSync(
    userId: string,
    integrationId: string,
    calendarConnectionId: string,
  ): Promise<void> {
    await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
      syncStatus: 'initial_sync_pending',
      syncToken: '',
      'fullSyncCheckpoint.nextPageToken': '',
      'fullSyncCheckpoint.syncedCount': 0,
      'fullSyncCheckpoint.pagesProcessed': 0,
    })
    await googleCalendarRepository.enqueueJob({
      userId,
      integrationId,
      calendarConnectionId,
      jobType: 'full_sync',
    })
  }

  private async handleCancelledRemoteItem(
    ctx: PulledItemContext,
    existingMapping: ExistingMappingDoc,
  ): Promise<void> {
    if (ctx.resource.recurringEventId) {
      await this.recordCancelledRecurringException(ctx)
    }
    if (!existingMapping) return

    await this.cleanupCancelledMapping(
      ctx.userId,
      String(ctx.calendar._id),
      existingMapping,
      Boolean(ctx.resource.recurringEventId),
    )
  }

  private async recordCancelledRecurringException(ctx: PulledItemContext): Promise<void> {
    if (!ctx.resource.recurringEventId) return
    const parentMapping = await googleCalendarRepository.findMappingByGoogleId(
      String(ctx.calendar._id),
      ctx.resource.recurringEventId,
    )
    const cancelledAt = this.resolveCancelledInstanceDate(ctx.resource, ctx.calendar.timeZone)
    if (!parentMapping || !cancelledAt || Number.isNaN(cancelledAt.getTime())) return

    await googleCalendarRepository.addExceptionDateToEvent(
      ctx.userId,
      parentMapping.eduTrackEventId,
      cancelledAt,
    )
  }

  private resolveCancelledInstanceDate(
    resource: GoogleCalendarEventResource,
    timeZone: string,
  ): Date | null {
    const mappedDate = googleEventToLocalFields(resource, timeZone)?.originalStartTime
    if (mappedDate) return mappedDate
    if (resource.originalStartTime?.dateTime) return new Date(resource.originalStartTime.dateTime)
    if (resource.originalStartTime?.date) {
      return new Date(`${resource.originalStartTime.date}T00:00:00Z`)
    }
    return null
  }

  private async cleanupCancelledMapping(
    userId: string,
    calendarConnectionId: string,
    existingMapping: NonNullable<ExistingMappingDoc>,
    isRecurringInstance: boolean,
  ): Promise<void> {
    const otherCount = await googleCalendarRepository.countActiveMappingsForEventExcludingCalendar(
      existingMapping.eduTrackEventId,
      calendarConnectionId,
    )
    const canDeleteLocal = await this.shouldDeleteOrphanedLocalEvent(
      userId,
      String(existingMapping.eduTrackEventId),
      otherCount,
      isRecurringInstance,
    )
    if (canDeleteLocal) {
      await googleCalendarRepository.deleteSyncedEvent(userId, existingMapping.eduTrackEventId)
    }
    await googleCalendarRepository.deleteMappingById(existingMapping._id)
  }

  private async shouldDeleteOrphanedLocalEvent(
    userId: string,
    eduTrackEventId: string,
    otherActiveMappingsCount: number,
    isRecurringInstance: boolean,
  ): Promise<boolean> {
    if (otherActiveMappingsCount > 0) return false
    if (isRecurringInstance) return true
    const localEvent = await googleCalendarRepository.findEventById(userId, eduTrackEventId)
    return Boolean(localEvent && localEvent.syncOrigin === 'google')
  }

  private async resolveRecurringParentId(
    ctx: PulledItemContext,
    mapped: MappedLocalEventFromGoogle,
  ): Promise<Types.ObjectId | null> {
    if (!ctx.resource.recurringEventId) return null
    const parentMapping = await googleCalendarRepository.findMappingByGoogleId(
      String(ctx.calendar._id),
      ctx.resource.recurringEventId,
    )
    if (!parentMapping) return null

    if (mapped.originalStartTime) {
      await googleCalendarRepository.addExceptionDateToEvent(
        ctx.userId,
        parentMapping.eduTrackEventId,
        mapped.originalStartTime,
      )
    }
    return new Types.ObjectId(String(parentMapping.eduTrackEventId))
  }

  private async insertNewLocalSyncedEvent(
    ctx: PulledItemContext,
    mapped: MappedLocalEventFromGoogle,
    canEdit: boolean,
    parentLocalEventId: Types.ObjectId | null,
  ): Promise<void> {
    const integrationId = String(ctx.integration._id)
    const calendarConnectionId = String(ctx.calendar._id)
    const displayColor = mapped.eventColor || ctx.calendar.backgroundColor
    const syncPoint = new Date()
    const remoteSnap = toNormalizedSyncSnapshot(mapped)

    const createdEvent = await googleCalendarRepository.createSyncedEvent({
      userId: ctx.userId,
      calendarId: null,
      entryType: 'event',
      title: mapped.title,
      description: mapped.description,
      priority: 'medium',
      startDate: mapped.startDate,
      endDate: mapped.endDate,
      isAllDay: mapped.isAllDay,
      location: mapped.location,
      onlineMeetingUrl: mapped.onlineMeetingUrl,
      color: displayColor,
      availability: mapped.availability,
      visibility: mapped.visibility,
      timeZone: mapped.timeZone,
      recurrence: mapped.recurrence,
      exceptionDates: mapped.exceptionDates,
      recurringEventId: parentLocalEventId,
      originalStartDate: mapped.originalStartTime,
      isGoogleReadOnly: !canEdit,
      googleSource: {
        integrationId,
        calendarConnectionId,
        accountEmail: ctx.integration.googleEmail,
        calendarName: ctx.calendar.summary,
        eventColorId: mapped.eventColorId,
        eventLabelId: mapped.eventLabelId,
        eventColor: mapped.eventColor,
        calendarColor: ctx.calendar.backgroundColor,
        accessRole: ctx.calendar.accessRole,
        creator: ctx.resource.creator
          ? {
              email: ctx.resource.creator.email,
              displayName: ctx.resource.creator.displayName,
            }
          : undefined,
        organizer: ctx.resource.organizer
          ? {
              email: ctx.resource.organizer.email,
              displayName: ctx.resource.organizer.displayName,
            }
          : undefined,
      },
      googleCalendarId: ctx.calendar.googleCalendarId,
      googleEventId: ctx.resource.id,
      googleEtag: mapped.etag,
      googleUpdatedAt: mapped.updatedAt,
      lastSyncedAt: syncPoint,
      syncOrigin: 'google',
    })

    await googleCalendarRepository.upsertMapping(calendarConnectionId, ctx.resource.id, {
      userId: ctx.userId,
      integrationId,
      calendarConnectionId,
      eduTrackEventId: createdEvent._id,
      googleCalendarId: ctx.calendar.googleCalendarId,
      googleEventId: ctx.resource.id,
      googleRecurringEventId: ctx.resource.recurringEventId ?? '',
      originalStartTime: mapped.originalStartTime,
      etag: mapped.etag,
      accessRole: ctx.calendar.accessRole,
      canEdit,
      organizerEmail: ctx.resource.organizer?.email ?? '',
      creatorEmail: ctx.resource.creator?.email ?? '',
      status: 'synced',
      lastSyncedAt: syncPoint,
      remoteUpdatedAt: mapped.updatedAt,
      localSyncedVersionAt: createdEvent.updatedAt,
      baseSnapshot: snapshotToDbRecord(remoteSnap),
    })
  }

  private async overwriteReadOnlyLocalEvent(
    ctx: PulledItemContext,
    existingMapping: NonNullable<ExistingMappingDoc>,
    localEventId: unknown,
    mapped: MappedLocalEventFromGoogle,
  ): Promise<void> {
    const syncPoint = new Date()
    const remoteSnap = toNormalizedSyncSnapshot(mapped)
    const displayColor = mapped.eventColor || ctx.calendar.backgroundColor

    await googleCalendarRepository.updateSyncedEvent(ctx.userId, localEventId, {
      title: mapped.title,
      description: mapped.description,
      startDate: mapped.startDate,
      endDate: mapped.endDate,
      isAllDay: mapped.isAllDay,
      location: mapped.location,
      onlineMeetingUrl: mapped.onlineMeetingUrl,
      color: displayColor,
      availability: mapped.availability,
      visibility: mapped.visibility,
      timeZone: mapped.timeZone,
      recurrence: mapped.recurrence,
      exceptionDates: mapped.exceptionDates,
      isGoogleReadOnly: true,
      'googleSource.calendarColor': ctx.calendar.backgroundColor,
      'googleSource.eventColorId': mapped.eventColorId,
      'googleSource.eventLabelId': mapped.eventLabelId,
      'googleSource.eventColor': mapped.eventColor,
      'googleSource.accessRole': ctx.calendar.accessRole,
      lastSyncedAt: syncPoint,
    })

    await googleCalendarRepository.updateMappingById(existingMapping._id, {
      accessRole: ctx.calendar.accessRole,
      canEdit: false,
      etag: mapped.etag,
      remoteUpdatedAt: mapped.updatedAt,
      lastSyncedAt: syncPoint,
      status: 'synced',
      baseSnapshot: snapshotToDbRecord(remoteSnap),
    })
  }

  private async mergeEditableLocalEvent(
    ctx: PulledItemContext,
    existingMapping: NonNullable<ExistingMappingDoc>,
    localEvent: ExistingLocalEventDoc,
    mapped: MappedLocalEventFromGoogle,
  ): Promise<void> {
    const integrationId = String(ctx.integration._id)
    const calendarConnectionId = String(ctx.calendar._id)
    const syncPoint = new Date()
    const remoteSnap = toNormalizedSyncSnapshot(mapped)
    const baseSnap = existingMapping.baseSnapshot
      ? toNormalizedSyncSnapshot(existingMapping.baseSnapshot)
      : undefined
    const localSnap = toNormalizedSyncSnapshot(localEvent)
    const mergeResult = computeThreeWaySyncDiff(baseSnap, localSnap, remoteSnap)

    if (mergeResult.conflictedFields.length > 0) {
      await googleCalendarRepository.upsertPendingConflict({
        userId: ctx.userId,
        integrationId,
        calendarConnectionId,
        mappingId: String(existingMapping._id),
        eventId: String(localEvent._id),
        googleEventId: ctx.resource.id,
        ...(baseSnap
          ? {
              baseVersion: {
                ...snapshotToDbRecord(baseSnap),
                updatedAt: existingMapping.lastSyncedAt ?? syncPoint,
              },
            }
          : {}),
        localVersion: { ...snapshotToDbRecord(localSnap), updatedAt: localEvent.updatedAt },
        googleVersion: {
          ...snapshotToDbRecord(remoteSnap),
          etag: mapped.etag,
          updatedAt: mapped.updatedAt,
        },
        conflictedFields: mergeResult.conflictedFields,
        localExpectedUpdatedAt: localEvent.updatedAt,
        remoteExpectedEtag: mapped.etag,
      })
      await googleCalendarRepository.updateMappingById(existingMapping._id, {
        status: 'conflict_pending',
        accessRole: ctx.calendar.accessRole,
        canEdit: true,
      })
      return
    }

    const remoteColorChanged = this.didRemoteColorChange(
      localEvent,
      ctx.calendar.backgroundColor,
      mapped,
    )
    const canApplyRemoteColor =
      existingMapping.status !== 'pending_push' && !mergeResult.needsPushToRemote
    const hasFieldUpdates = Object.keys(mergeResult.mergedLocalFields).length > 0

    if (hasFieldUpdates || (remoteColorChanged && canApplyRemoteColor)) {
      const displayColor = mapped.eventColor || ctx.calendar.backgroundColor
      await googleCalendarRepository.updateSyncedEvent(ctx.userId, localEvent._id, {
        ...mergeResult.mergedLocalFields,
        ...(mapped.exceptionDates.length > 0 ? { exceptionDates: mapped.exceptionDates } : {}),
        ...(canApplyRemoteColor
          ? {
              color: displayColor,
              'googleSource.calendarColor': ctx.calendar.backgroundColor,
              'googleSource.eventColorId': mapped.eventColorId,
              'googleSource.eventLabelId': mapped.eventLabelId,
              'googleSource.eventColor': mapped.eventColor,
            }
          : {}),
        isGoogleReadOnly: false,
        lastSyncedAt: syncPoint,
      })
    }

    await googleCalendarRepository.updateMappingById(existingMapping._id, {
      accessRole: ctx.calendar.accessRole,
      canEdit: true,
      etag: mapped.etag,
      remoteUpdatedAt: mapped.updatedAt,
      lastSyncedAt: syncPoint,
      status: mergeResult.needsPushToRemote ? 'pending_push' : 'synced',
      ...(mergeResult.needsPushToRemote
        ? {}
        : { baseSnapshot: snapshotToDbRecord(remoteSnap) }),
    })

    if (mergeResult.needsPushToRemote) {
      await googleCalendarRepository.enqueueJob({
        userId: ctx.userId,
        integrationId,
        calendarConnectionId,
        mappingId: String(existingMapping._id),
        eventId: String(localEvent._id),
        jobType: 'event_push',
      })
    }
  }

  private didRemoteColorChange(
    localEvent: ExistingLocalEventDoc,
    calendarBackgroundColor: string,
    mapped: MappedLocalEventFromGoogle,
  ): boolean {
    const existingColorId = localEvent.googleSource?.eventColorId ?? ''
    const existingLabelId = localEvent.googleSource?.eventLabelId ?? ''
    const existingEventColor = localEvent.googleSource?.eventColor ?? ''
    const existingCalendarColor = localEvent.googleSource?.calendarColor ?? ''

    return (
      mapped.eventColorId !== existingColorId ||
      mapped.eventLabelId !== existingLabelId ||
      mapped.eventColor !== existingEventColor ||
      Boolean(calendarBackgroundColor && calendarBackgroundColor !== existingCalendarColor)
    )
  }
}
