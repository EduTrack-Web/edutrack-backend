import { randomUUID } from 'node:crypto'
import type { Types } from 'mongoose'
import { AppError } from '@/shared/errors/app-error.js'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import {
  GoogleCalendarApiError,
  type GoogleCalendarAdapter,
  type GoogleCalendarEventResource,
  type GoogleEventUpsertPayload,
} from '@/modules/calendar/services/google-calendar.adapter.js'
import {
  localEventToGooglePayload,
  toNormalizedSyncSnapshot,
} from '@/modules/calendar/services/google-calendar-mapper.js'
import {
  isReadOnlyForbiddenError,
  snapshotToDbRecord,
  type ClaimedSyncJob,
} from '@/modules/calendar/services/google-sync-errors.js'
import type { GoogleTokenManager } from '@/modules/calendar/services/google-token.manager.js'
import type { GoogleCalendarAccessRole } from '@/modules/calendar/types/calendar.types.js'

export class GoogleOutboundSyncProcessor {
  public constructor(
    private readonly adapter: GoogleCalendarAdapter,
    private readonly tokenManager: GoogleTokenManager,
  ) {}

  public async enqueueLocalEventPush(userId: string, eventId: string): Promise<void> {
    try {
      const event = await googleCalendarRepository.findEventById(userId, eventId)
      if (!event || event.entryType !== 'event') return

      if (event.syncOrigin === 'google') {
        await this.enqueueGoogleOriginEventPush(userId, eventId)
        return
      }

      await this.enqueueLocalOriginEventPush(userId, eventId)
    } catch (error: unknown) {
      console.error(
        '[GoogleCalendarSync] enqueueLocalEventPush error:',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  public async enqueueDetachedGoogleEventPush(
    userId: string,
    sourceEventId: string,
    newEventId: string,
  ): Promise<void> {
    try {
      const sourceMappings = await googleCalendarRepository.findMappingsByEventId(
        userId,
        sourceEventId,
      )
      const editableMappings = sourceMappings.filter(
        (m) =>
          m.canEdit &&
          m.status !== 'suppressed_local_delete' &&
          m.status !== 'pending_delete',
      )

      for (const sourceMapping of editableMappings) {
        await this.enqueueDetachedTargetMapping(userId, newEventId, sourceMapping)
      }
    } catch (error: unknown) {
      console.error(
        '[GoogleCalendarSync] enqueueDetachedGoogleEventPush error:',
        error instanceof Error ? error.message : 'Unknown error',
      )
    }
  }

  public async enqueueLocalEventDelete(
    userId: string,
    eventId: string,
    scope: 'local_only' | 'both',
  ): Promise<void> {
    const mappings = await googleCalendarRepository.findMappingsByEventId(userId, eventId)
    for (const mapping of mappings) {
      const isPendingOnly = mapping.googleEventId.startsWith('pending:')
      if (isPendingOnly) {
        await googleCalendarRepository.deleteMappingById(mapping._id)
        continue
      }

      if (scope === 'local_only' || !mapping.canEdit) {
        await googleCalendarRepository.updateMappingById(mapping._id, {
          status: 'suppressed_local_delete',
        })
        continue
      }

      await googleCalendarRepository.updateMappingById(mapping._id, {
        status: 'pending_delete',
      })
      await googleCalendarRepository.enqueueJob({
        userId,
        integrationId: String(mapping.integrationId),
        calendarConnectionId: String(mapping.calendarConnectionId),
        mappingId: String(mapping._id),
        eventId,
        jobType: 'event_delete',
      })
    }
  }

  public async executeEventPushJob(job: ClaimedSyncJob): Promise<void> {
    if (!job.mappingId) return
    const userId = String(job.userId)
    const integrationId = String(job.integrationId)
    const mapping = await googleCalendarRepository.findMappingById(userId, String(job.mappingId))
    if (!mapping || !this.canPushMapping(mapping)) return

    const [integration, calendar, event] = await Promise.all([
      googleCalendarRepository.findIntegrationById(userId, integrationId),
      googleCalendarRepository.findCalendarById(userId, String(mapping.calendarConnectionId)),
      googleCalendarRepository.findEventById(userId, String(mapping.eduTrackEventId)),
    ])
    if (!integration || integration.status !== 'connected' || !calendar || !event) return
    if (event.syncOrigin === 'local' && !integration.syncToGoogleEnabled) return

    const isUntouchedInheritedGoogleColor = this.isInheritedGoogleCalendarColor(
      event,
      calendar.backgroundColor,
    )
    const hasPreservedGoogleLabel = Boolean(event.googleSource?.eventLabelId)
    const colorPalette = await this.tokenManager.fetchEventColorPaletteSafe(userId, integrationId)
    const isPendingPlaceholder =
      !mapping.googleEventId || mapping.googleEventId.startsWith('pending:')

    const payload = localEventToGooglePayload({
      title: event.title,
      description: event.description,
      startDate: event.startDate,
      endDate: event.endDate,
      isAllDay: event.isAllDay,
      location: event.location,
      onlineMeetingUrl: event.onlineMeetingUrl,
      color: isUntouchedInheritedGoogleColor ? '' : event.color,
      isGoogleLinked: !isPendingPlaceholder || Boolean(event.googleSource),
      skipColorPatch: hasPreservedGoogleLabel,
      ...(colorPalette ? { colorPalette } : {}),
      availability: event.availability,
      visibility: event.visibility,
      timeZone: event.timeZone,
      recurrence: event.recurrence,
      exceptionDates: (event.exceptionDates ?? []).map(
        (d) => new Date(d as unknown as string | number | Date),
      ),
    })

    try {
      const remoteResource = await this.upsertEventOnGoogle({
        userId,
        integrationId,
        calendarId: calendar.googleCalendarId,
        googleEventId: mapping.googleEventId,
        isPendingPlaceholder,
        payload,
      })

      const now = new Date()
      const snap = toNormalizedSyncSnapshot(event)
      await googleCalendarRepository.updateMappingById(mapping._id, {
        googleEventId: remoteResource.id,
        etag: remoteResource.etag ?? '',
        remoteUpdatedAt: remoteResource.updated ? new Date(remoteResource.updated) : now,
        lastSyncedAt: now,
        localSyncedVersionAt: event.updatedAt,
        status: 'synced',
        baseSnapshot: snapshotToDbRecord(snap),
      })

      const pushedColorId = remoteResource.colorId ?? ''
      const pushedLabelId =
        remoteResource.eventLabelId ??
        (hasPreservedGoogleLabel ? (event.googleSource?.eventLabelId ?? '') : '')

      await googleCalendarRepository.updateSyncedEvent(userId, event._id, {
        googleEventId: remoteResource.id,
        googleEtag: remoteResource.etag ?? '',
        ...(event.googleSource
          ? {
              'googleSource.eventColorId': pushedColorId,
              'googleSource.eventLabelId': pushedLabelId,
              'googleSource.eventColor': event.color ? event.color : '',
            }
          : {}),
        lastSyncedAt: now,
      })
    } catch (error: unknown) {
      if (isReadOnlyForbiddenError(error)) {
        await this.demoteMappingToReadOnly(userId, mapping._id, event._id)
      }
      throw error
    }
  }

  public async executeEventDeleteJob(job: ClaimedSyncJob): Promise<void> {
    if (!job.mappingId) return
    const userId = String(job.userId)
    const integrationId = String(job.integrationId)
    const mapping = await googleCalendarRepository.findMappingById(userId, String(job.mappingId))
    if (!mapping || mapping.status !== 'pending_delete') return

    const calendar = await googleCalendarRepository.findCalendarById(
      userId,
      String(mapping.calendarConnectionId),
    )
    if (!calendar) {
      await googleCalendarRepository.deleteMappingById(mapping._id)
      return
    }

    if (!mapping.googleEventId.startsWith('pending:')) {
      await this.tokenManager.withValidToken(userId, integrationId, (accessToken) =>
        this.adapter.deleteEvent({
          accessToken,
          calendarId: calendar.googleCalendarId,
          googleEventId: mapping.googleEventId,
        }),
      )
    }

    await googleCalendarRepository.deleteMappingById(mapping._id)
  }

  public async pushResolvedConflictToGoogle(userId: string, conflictId: string): Promise<void> {
    const conflict = await googleCalendarRepository.findConflictById(userId, conflictId)
    if (
      !conflict ||
      !conflict.integrationId ||
      !conflict.calendarConnectionId ||
      !conflict.mappingId
    ) {
      return
    }

    const [event, calendar] = await Promise.all([
      googleCalendarRepository.findEventById(userId, String(conflict.eventId)),
      googleCalendarRepository.findCalendarById(userId, String(conflict.calendarConnectionId)),
    ])
    if (!event || !calendar) return

    const integrationId = String(conflict.integrationId)
    const payload = localEventToGooglePayload({
      title: event.title,
      description: event.description,
      startDate: event.startDate,
      endDate: event.endDate,
      isAllDay: event.isAllDay,
      location: event.location,
      onlineMeetingUrl: event.onlineMeetingUrl,
      availability: event.availability,
      visibility: event.visibility,
      timeZone: event.timeZone,
      recurrence: event.recurrence,
      exceptionDates: (event.exceptionDates ?? []).map(
        (d) => new Date(d as unknown as string | number | Date),
      ),
    })

    let updatedRemote: GoogleCalendarEventResource
    try {
      updatedRemote = await this.tokenManager.withValidToken(
        userId,
        integrationId,
        (accessToken) =>
          this.adapter.updateEvent({
            accessToken,
            calendarId: calendar.googleCalendarId,
            googleEventId: conflict.googleEventId,
            payload,
          }),
      )
    } catch {
      await googleCalendarRepository.enqueueJob({
        userId,
        integrationId,
        calendarConnectionId: String(conflict.calendarConnectionId),
        mappingId: String(conflict.mappingId),
        eventId: String(conflict.eventId),
        conflictId,
        jobType: 'conflict_resolve',
      })
      throw new AppError(
        502,
        'GOOGLE_CALENDAR_SYNC_FAILED',
        'Đã lưu lựa chọn trên EduTrack nhưng chưa đẩy được lên Google. Hệ thống đã đưa vào hàng đợi thử lại.',
      )
    }

    const now = new Date()
    const mergedSnap = toNormalizedSyncSnapshot(event)
    await googleCalendarRepository.updateMappingById(conflict.mappingId, {
      etag: updatedRemote.etag ?? '',
      remoteUpdatedAt: updatedRemote.updated ? new Date(updatedRemote.updated) : now,
      lastSyncedAt: now,
      localSyncedVersionAt: event.updatedAt,
      status: 'synced',
      baseSnapshot: snapshotToDbRecord(mergedSnap),
    })
    await googleCalendarRepository.updateSyncedEvent(userId, event._id, {
      googleEtag: updatedRemote.etag ?? '',
      lastSyncedAt: now,
    })
    await googleCalendarRepository.updateConflictById(conflictId, {
      status: 'resolved_merged',
      resolvedAt: now,
    })
  }

  private canPushMapping(mapping: { canEdit?: boolean; status?: string }): boolean {
    return Boolean(
      mapping.canEdit &&
        mapping.status !== 'suppressed_local_delete' &&
        mapping.status !== 'conflict_pending' &&
        mapping.status !== 'resolution_pending',
    )
  }

  private isInheritedGoogleCalendarColor(
    event: {
      color?: string
      googleSource?: {
        eventColorId?: string
        eventLabelId?: string
        eventColor?: string
      } | null
    },
    calendarBackgroundColor: string,
  ): boolean {
    if (!event.googleSource || !event.color || !calendarBackgroundColor) return false
    if (
      event.googleSource.eventColorId ||
      event.googleSource.eventLabelId ||
      event.googleSource.eventColor
    ) {
      return false
    }
    return event.color.trim().toLowerCase() === calendarBackgroundColor.trim().toLowerCase()
  }

  private async enqueueGoogleOriginEventPush(userId: string, eventId: string): Promise<void> {
    const mappings = await googleCalendarRepository.findMappingsByEventId(userId, eventId)
    for (const mapping of mappings) {
      if (
        !mapping.canEdit ||
        mapping.status === 'suppressed_local_delete' ||
        mapping.status === 'conflict_pending'
      ) {
        continue
      }
      const integration = await googleCalendarRepository.findIntegrationById(
        userId,
        String(mapping.integrationId),
      )
      if (!integration || integration.status !== 'connected' || !integration.syncToGoogleEnabled) {
        continue
      }
      await googleCalendarRepository.updateMappingById(mapping._id, { status: 'pending_push' })
      await googleCalendarRepository.enqueueJob({
        userId,
        integrationId: String(mapping.integrationId),
        calendarConnectionId: String(mapping.calendarConnectionId),
        mappingId: String(mapping._id),
        eventId,
        jobType: 'event_push',
      })
    }
  }

  private async enqueueLocalOriginEventPush(userId: string, eventId: string): Promise<void> {
    const pushTargets = await googleCalendarRepository.findPushTargetIntegrations(userId)
    for (const integration of pushTargets) {
      const integrationId = String(integration._id)
      const primaryCal = await googleCalendarRepository.findPrimaryCalendarForIntegration(
        userId,
        integrationId,
      )
      if (!primaryCal) continue

      await this.ensureMappingAndEnqueuePush({
        userId,
        integrationId,
        calendarConnectionId: String(primaryCal._id),
        googleCalendarId: primaryCal.googleCalendarId,
        accessRole: primaryCal.accessRole as GoogleCalendarAccessRole,
        canEdit: primaryCal.accessRole === 'writer' || primaryCal.accessRole === 'owner',
        eventId,
      })
    }
  }

  private async enqueueDetachedTargetMapping(
    userId: string,
    newEventId: string,
    sourceMapping: {
      integrationId: unknown
      calendarConnectionId: unknown
      googleCalendarId: string
      accessRole: string
      canEdit: boolean
    },
  ): Promise<void> {
    const integrationId = String(sourceMapping.integrationId)
    const integration = await googleCalendarRepository.findIntegrationById(userId, integrationId)
    if (!integration || integration.status !== 'connected') return

    await this.ensureMappingAndEnqueuePush({
      userId,
      integrationId,
      calendarConnectionId: String(sourceMapping.calendarConnectionId),
      googleCalendarId: sourceMapping.googleCalendarId,
      accessRole: sourceMapping.accessRole as GoogleCalendarAccessRole,
      canEdit: sourceMapping.canEdit,
      eventId: newEventId,
    })
  }

  private async ensureMappingAndEnqueuePush(params: {
    userId: string
    integrationId: string
    calendarConnectionId: string
    googleCalendarId: string
    accessRole: GoogleCalendarAccessRole
    canEdit: boolean
    eventId: string
  }): Promise<void> {
    const existing = await googleCalendarRepository.findMappingByEventAndCalendar(
      params.eventId,
      params.calendarConnectionId,
    )
    if (
      existing &&
      (existing.status === 'suppressed_local_delete' || existing.status === 'conflict_pending')
    ) {
      return
    }

    const mapping = existing
      ? await googleCalendarRepository.updateMappingById(existing._id, { status: 'pending_push' })
      : await googleCalendarRepository.createMapping({
          userId: params.userId,
          integrationId: params.integrationId,
          calendarConnectionId: params.calendarConnectionId,
          eduTrackEventId: params.eventId,
          googleCalendarId: params.googleCalendarId,
          googleEventId: `pending:${params.eventId}:${params.calendarConnectionId}`,
          accessRole: params.accessRole,
          canEdit: params.canEdit,
          status: 'pending_push',
          idempotencyKey: `edutrack-${params.eventId}-${randomUUID()}`,
        })
    if (!mapping) return

    await googleCalendarRepository.enqueueJob({
      userId: params.userId,
      integrationId: params.integrationId,
      calendarConnectionId: params.calendarConnectionId,
      mappingId: String(mapping._id),
      eventId: params.eventId,
      jobType: 'event_push',
      idempotencyKey: mapping.idempotencyKey || '',
    })
  }

  private async upsertEventOnGoogle(params: {
    userId: string
    integrationId: string
    calendarId: string
    googleEventId: string
    isPendingPlaceholder: boolean
    payload: GoogleEventUpsertPayload
  }): Promise<GoogleCalendarEventResource> {
    if (params.isPendingPlaceholder) {
      return this.tokenManager.withValidToken(
        params.userId,
        params.integrationId,
        (accessToken) =>
          this.adapter.insertEvent({
            accessToken,
            calendarId: params.calendarId,
            payload: params.payload,
          }),
      )
    }

    try {
      return await this.tokenManager.withValidToken(
        params.userId,
        params.integrationId,
        (accessToken) =>
          this.adapter.updateEvent({
            accessToken,
            calendarId: params.calendarId,
            googleEventId: params.googleEventId,
            payload: params.payload,
          }),
      )
    } catch (error: unknown) {
      const isDeletedRemotely =
        error instanceof GoogleCalendarApiError &&
        (error.status === 404 || error.status === 410)
      if (!isDeletedRemotely) throw error

      return this.tokenManager.withValidToken(
        params.userId,
        params.integrationId,
        (accessToken) =>
          this.adapter.insertEvent({
            accessToken,
            calendarId: params.calendarId,
            payload: params.payload,
          }),
      )
    }
  }

  private async demoteMappingToReadOnly(
    userId: string,
    mappingId: unknown,
    eventId: Types.ObjectId,
  ): Promise<void> {
    await googleCalendarRepository.updateMappingById(mappingId, {
      canEdit: false,
      status: 'synced',
    })
    const remainingEditable =
      await googleCalendarRepository.countEditableMappingsForEvent(eventId)
    if (remainingEditable === 0) {
      await googleCalendarRepository.updateSyncedEvent(userId, eventId, {
        isGoogleReadOnly: true,
      })
    }
  }
}
