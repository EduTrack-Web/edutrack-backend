import { Types } from 'mongoose'
import { UserModel } from '@/modules/auth/models/user.model.js'
import { EventModel } from '@/modules/calendar/models/event.model.js'
import { GoogleCalendarConflictModel } from '@/modules/calendar/models/google-calendar-conflict.model.js'
import { GoogleCalendarIntegrationModel } from '@/modules/calendar/models/google-calendar-integration.model.js'
import { GoogleCalendarModel } from '@/modules/calendar/models/google-calendar.model.js'
import { GoogleEventMappingModel } from '@/modules/calendar/models/google-event-mapping.model.js'
import { GoogleOAuthNonceModel } from '@/modules/calendar/models/google-oauth-nonce.model.js'
import { GoogleSyncJobModel } from '@/modules/calendar/models/google-sync-job.model.js'
import type { GoogleCalendarListItemResource } from '@/modules/calendar/services/google-calendar.adapter.js'

const isValidObjectId = (id: string): boolean => Types.ObjectId.isValid(id)

export const syncGoogleCalendarIndexes = async (): Promise<void> => {
  await Promise.all([
    GoogleCalendarIntegrationModel.syncIndexes(),
    GoogleCalendarModel.syncIndexes(),
    GoogleEventMappingModel.syncIndexes(),
    GoogleSyncJobModel.syncIndexes(),
    GoogleCalendarConflictModel.syncIndexes(),
    GoogleOAuthNonceModel.syncIndexes(),
  ])
}

export const googleCalendarRepository = {
  isActiveUser: async (userId: string): Promise<boolean> => {
    if (!isValidObjectId(userId)) return false
    const exists = await UserModel.exists({ _id: userId, status: 'active' })
    return Boolean(exists)
  },

  consumeOAuthNonce: async (nonce: string, userId: string): Promise<boolean> => {
    if (!nonce || !isValidObjectId(userId)) return false
    try {
      await GoogleOAuthNonceModel.create({ nonce, userId })
      return true
    } catch {
      return false
    }
  },

  findIntegrationsByUserId: (userId: string) =>
    GoogleCalendarIntegrationModel.find({ userId })
      .sort({ isPrimarySyncAccount: -1, createdAt: 1 })
      .lean(),

  countIntegrationsByUserId: (userId: string) =>
    GoogleCalendarIntegrationModel.countDocuments({ userId }),

  findIntegrationById: (userId: string, integrationId: string, includeTokens = false) => {
    if (!isValidObjectId(integrationId)) return Promise.resolve(null)
    const query = GoogleCalendarIntegrationModel.findOne({ _id: integrationId, userId })
    if (includeTokens) {
      query.select('+encryptedAccessToken +encryptedRefreshToken')
    }
    return query.lean()
  },

  findIntegrationBySub: (userId: string, googleSub: string, includeTokens = false) => {
    const query = GoogleCalendarIntegrationModel.findOne({ userId, googleSub })
    if (includeTokens) {
      query.select('+encryptedAccessToken +encryptedRefreshToken')
    }
    return query.lean()
  },

  findPushTargetIntegrations: (userId: string) =>
    GoogleCalendarIntegrationModel.find({
      userId,
      status: 'connected',
      syncToGoogleEnabled: true,
    })
      .sort({ isPrimarySyncAccount: -1, createdAt: 1 })
      .lean(),

  createOrUpdateIntegrationBySub: (
    userId: string,
    googleSub: string,
    fields: Record<string, unknown>,
    insertDefaults: Record<string, unknown>,
  ) =>
    GoogleCalendarIntegrationModel.findOneAndUpdate(
      { userId, googleSub },
      { $set: fields, $setOnInsert: insertDefaults },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean(),

  updateIntegrationById: (
    userId: string,
    integrationId: string,
    fields: Record<string, unknown>,
  ) => {
    if (!isValidObjectId(integrationId)) return Promise.resolve(null)
    return GoogleCalendarIntegrationModel.findOneAndUpdate(
      { _id: integrationId, userId },
      { $set: fields },
      { returnDocument: 'after', runValidators: true },
    ).lean()
  },

  setPrimarySyncAccount: async (userId: string, integrationId: string) => {
    if (!isValidObjectId(integrationId)) return null
    await GoogleCalendarIntegrationModel.updateMany(
      { userId, _id: { $ne: integrationId } },
      { $set: { isPrimarySyncAccount: false } },
    )
    return GoogleCalendarIntegrationModel.findOneAndUpdate(
      { _id: integrationId, userId },
      { $set: { isPrimarySyncAccount: true } },
      { returnDocument: 'after' },
    ).lean()
  },

  ensureFallbackPrimaryAccount: async (userId: string) => {
    const hasPrimary = await GoogleCalendarIntegrationModel.exists({ userId, isPrimarySyncAccount: true })
    if (hasPrimary) return
    const first = await GoogleCalendarIntegrationModel.findOne({ userId }).sort({ createdAt: 1 }).lean()
    if (first) {
      await GoogleCalendarIntegrationModel.updateOne(
        { _id: first._id },
        { $set: { isPrimarySyncAccount: true } },
      )
    }
  },

  deleteIntegrationById: (userId: string, integrationId: string) => {
    if (!isValidObjectId(integrationId)) return Promise.resolve(null)
    return GoogleCalendarIntegrationModel.findOneAndDelete({ _id: integrationId, userId }).lean()
  },

  upsertCalendarsFromGoogle: async (
    userId: string,
    integrationId: string,
    items: readonly GoogleCalendarListItemResource[],
  ) => {
    const bulkOps = items.map((item) => ({
      updateOne: {
        filter: { integrationId: new Types.ObjectId(integrationId), googleCalendarId: item.id },
        update: {
          $set: {
            summary: item.summary,
            description: item.description,
            backgroundColor: item.backgroundColor,
            foregroundColor: item.foregroundColor,
            timeZone: item.timeZone,
            accessRole: item.accessRole,
            isPrimary: item.primary,
          },
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            integrationId: new Types.ObjectId(integrationId),
            googleCalendarId: item.id,
            isSelected: false,
            isVisible: true,
            syncStatus: 'unselected',
          },
        },
        upsert: true,
      },
    }))
    if (bulkOps.length > 0) {
      await GoogleCalendarModel.bulkWrite(bulkOps)
    }
    return GoogleCalendarModel.find({ userId, integrationId })
      .sort({ isPrimary: -1, summary: 1 })
      .lean()
  },

  findCalendarsByIntegrationId: (userId: string, integrationId: string) =>
    GoogleCalendarModel.find({ userId, integrationId })
      .sort({ isPrimary: -1, summary: 1 })
      .lean(),

  findCalendarsByUserId: (userId: string) =>
    GoogleCalendarModel.find({ userId })
      .sort({ isPrimary: -1, summary: 1 })
      .lean(),

  findCalendarById: (userId: string, calendarConnectionId: string) => {
    if (!isValidObjectId(calendarConnectionId)) return Promise.resolve(null)
    return GoogleCalendarModel.findOne({ _id: calendarConnectionId, userId }).lean()
  },

  findPrimaryCalendarForIntegration: (userId: string, integrationId: string) =>
    GoogleCalendarModel.findOne({ userId, integrationId, isPrimary: true }).lean(),

  findDueActiveCalendarsForIncrementalSync: (now: Date) =>
    GoogleCalendarModel.find({
      isSelected: true,
      syncStatus: 'active',
      $or: [{ nextSyncAt: null }, { nextSyncAt: { $lte: now } }],
    }).lean(),

  findCalendarByWatchChannelId: (channelId: string) => {
    if (!channelId.trim()) return Promise.resolve(null)
    return GoogleCalendarModel.findOne({ 'watchChannel.channelId': channelId.trim() }).lean()
  },

  findSelectedCalendarsNeedingWatchRenewal: (renewBefore: Date) =>
    GoogleCalendarModel.find({
      isSelected: true,
      syncStatus: 'active',
      $or: [
        { 'watchChannel.channelId': '' },
        { 'watchChannel.expiration': null },
        { 'watchChannel.expiration': { $lte: renewBefore } },
      ],
    }).lean(),

  updateCalendarById: (
    calendarConnectionId: string,
    fields: Record<string, unknown>,
  ) =>
    GoogleCalendarModel.findByIdAndUpdate(
      calendarConnectionId,
      { $set: fields },
      { returnDocument: 'after', runValidators: true },
    ).lean(),

  deleteCalendarsByIntegrationId: (userId: string, integrationId: string) =>
    GoogleCalendarModel.deleteMany({ userId, integrationId }),

  findMappingByGoogleId: (calendarConnectionId: string, googleEventId: string) =>
    GoogleEventMappingModel.findOne({ calendarConnectionId, googleEventId }).lean(),

  findMappingByEventAndCalendar: (eduTrackEventId: string, calendarConnectionId: string) =>
    GoogleEventMappingModel.findOne({ eduTrackEventId, calendarConnectionId }).lean(),

  findMappingsByEventId: (userId: string, eduTrackEventId: string) => {
    if (!isValidObjectId(eduTrackEventId)) return Promise.resolve([])
    return GoogleEventMappingModel.find({ userId, eduTrackEventId }).lean()
  },

  findMappingsByCalendarId: (userId: string, calendarConnectionId: string) =>
    GoogleEventMappingModel.find({ userId, calendarConnectionId }).lean(),

  findMappingById: (userId: string, mappingId: string) => {
    if (!isValidObjectId(mappingId)) return Promise.resolve(null)
    return GoogleEventMappingModel.findOne({ _id: mappingId, userId }).lean()
  },

  upsertMapping: (
    calendarConnectionId: string,
    googleEventId: string,
    fields: Record<string, unknown>,
  ) =>
    GoogleEventMappingModel.findOneAndUpdate(
      { calendarConnectionId, googleEventId },
      { $set: fields },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean(),

  createMapping: async (doc: Record<string, unknown>) => {
    const created = await GoogleEventMappingModel.create(doc)
    return GoogleEventMappingModel.findById(created._id).lean()
  },

  updateMappingById: (mappingId: unknown, fields: Record<string, unknown>) =>
    GoogleEventMappingModel.findByIdAndUpdate(
      mappingId,
      { $set: fields },
      { returnDocument: 'after' },
    ).lean(),

  deleteMappingById: (mappingId: unknown) =>
    GoogleEventMappingModel.findByIdAndDelete(mappingId).lean(),

  deleteMappingsByCalendarId: (userId: string, calendarConnectionId: string) =>
    GoogleEventMappingModel.deleteMany({ userId, calendarConnectionId }),

  deleteMappingsByIntegrationId: (userId: string, integrationId: string) =>
    GoogleEventMappingModel.deleteMany({ userId, integrationId }),

  countActiveMappingsForEventExcludingCalendar: (
    eduTrackEventId: Types.ObjectId | string,
    excludedCalendarConnectionId: string,
  ) =>
    GoogleEventMappingModel.countDocuments({
      eduTrackEventId,
      calendarConnectionId: { $ne: new Types.ObjectId(excludedCalendarConnectionId) },
    }),

  countEditableMappingsForEvent: (eduTrackEventId: Types.ObjectId | string) =>
    GoogleEventMappingModel.countDocuments({
      eduTrackEventId,
      status: { $ne: 'suppressed_local_delete' },
      canEdit: true,
    }),

  findEventById: (userId: string, eventId: string) => {
    if (!isValidObjectId(eventId)) return Promise.resolve(null)
    return EventModel.findOne({ _id: eventId, userId }).lean()
  },

  createSyncedEvent: (doc: Record<string, unknown>) => EventModel.create(doc),

  updateSyncedEvent: (userId: string, eventId: unknown, fields: Record<string, unknown>) =>
    EventModel.updateOne({ _id: eventId, userId }, { $set: fields }),

  addExceptionDateToEvent: (userId: string, eventId: unknown, date: Date) =>
    EventModel.updateOne(
      { _id: eventId, userId },
      { $addToSet: { exceptionDates: date } },
    ),

  deleteSyncedEvent: (userId: string, eventId: unknown) =>
    EventModel.deleteOne({ _id: eventId, userId }),

  findPendingConflictsByUserId: (userId: string) =>
    GoogleCalendarConflictModel.find({
      userId,
      status: { $in: ['pending', 'resolution_pending'] },
    })
      .sort({ createdAt: 1 })
      .lean(),

  countPendingConflictsByUserId: (userId: string) =>
    GoogleCalendarConflictModel.countDocuments({
      userId,
      status: { $in: ['pending', 'resolution_pending'] },
    }),

  countPendingConflictsByIntegrationId: (userId: string, integrationId: string) =>
    GoogleCalendarConflictModel.countDocuments({
      userId,
      integrationId,
      status: { $in: ['pending', 'resolution_pending'] },
    }),

  findConflictById: (userId: string, conflictId: string) => {
    if (!isValidObjectId(conflictId)) return Promise.resolve(null)
    return GoogleCalendarConflictModel.findOne({
      _id: conflictId,
      userId,
      status: { $in: ['pending', 'resolution_pending'] },
    }).lean()
  },

  upsertPendingConflict: (params: {
    userId: string
    integrationId: string
    calendarConnectionId: string
    mappingId: string
    eventId: string
    googleEventId: string
    baseVersion?: Record<string, unknown>
    localVersion: Record<string, unknown>
    googleVersion: Record<string, unknown>
    conflictedFields: string[]
    localExpectedUpdatedAt: Date
    remoteExpectedEtag: string
  }) =>
    GoogleCalendarConflictModel.findOneAndUpdate(
      {
        userId: params.userId,
        eventId: params.eventId,
        calendarConnectionId: params.calendarConnectionId,
        status: { $in: ['pending', 'resolution_pending'] },
      },
      {
        $set: {
          integrationId: params.integrationId,
          mappingId: params.mappingId,
          googleEventId: params.googleEventId,
          ...(params.baseVersion ? { baseVersion: params.baseVersion } : {}),
          localVersion: params.localVersion,
          googleVersion: params.googleVersion,
          conflictedFields: params.conflictedFields,
          localExpectedUpdatedAt: params.localExpectedUpdatedAt,
          remoteExpectedEtag: params.remoteExpectedEtag,
          status: 'pending',
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true },
    ).lean(),

  updateConflictById: (conflictId: string, fields: Record<string, unknown>) =>
    GoogleCalendarConflictModel.findByIdAndUpdate(
      conflictId,
      { $set: fields },
      { returnDocument: 'after' },
    ).lean(),

  deleteConflictsByIntegrationId: (userId: string, integrationId: string) =>
    GoogleCalendarConflictModel.deleteMany({ userId, integrationId }),

  deleteConflictsByCalendarId: (userId: string, calendarConnectionId: string) =>
    GoogleCalendarConflictModel.deleteMany({ userId, calendarConnectionId }),

  enqueueJob: async (doc: {
    userId: string
    integrationId: string
    calendarConnectionId?: string | null
    mappingId?: string | null
    eventId?: string | null
    conflictId?: string | null
    jobType: 'full_sync' | 'incremental_sync' | 'event_push' | 'event_delete' | 'conflict_resolve'
    idempotencyKey?: string
    checkpoint?: Record<string, unknown>
    nextRetryAt?: Date
  }) => {
    try {
      return await GoogleSyncJobModel.create({
        userId: doc.userId,
        integrationId: doc.integrationId,
        calendarConnectionId: doc.calendarConnectionId ?? null,
        mappingId: doc.mappingId ?? null,
        eventId: doc.eventId ?? null,
        conflictId: doc.conflictId ?? null,
        jobType: doc.jobType,
        status: 'pending',
        idempotencyKey: doc.idempotencyKey ?? '',
        checkpoint: doc.checkpoint ?? {},
        nextRetryAt: doc.nextRetryAt ?? new Date(),
      })
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 11000
      ) {
        return null
      }
      throw error
    }
  },

  claimNextDueJob: (workerId: string, now: Date, leaseDurationMs: number) => {
    const nextLeaseExpiry = new Date(now.getTime() + leaseDurationMs)
    return GoogleSyncJobModel.findOneAndUpdate(
      {
        $or: [
          {
            status: { $in: ['pending', 'retry_wait'] },
            nextRetryAt: { $lte: now },
            $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: now } }],
          },
          {
            status: 'running',
            leaseExpiresAt: { $lte: now },
          },
        ],
      },
      {
        $set: {
          status: 'running',
          leaseOwner: workerId,
          leaseExpiresAt: nextLeaseExpiry,
        },
      },
      {
        sort: { nextRetryAt: 1, createdAt: 1 },
        returnDocument: 'after',
      },
    ).lean()
  },

  claimActiveJobForCalendar: (
    calendarConnectionId: string,
    jobType: 'full_sync' | 'incremental_sync',
    workerId: string,
    now: Date,
    leaseDurationMs: number,
  ) => {
    if (!isValidObjectId(calendarConnectionId)) return Promise.resolve(null)
    const nextLeaseExpiry = new Date(now.getTime() + leaseDurationMs)
    return GoogleSyncJobModel.findOneAndUpdate(
      {
        calendarConnectionId,
        jobType,
        $or: [
          {
            status: { $in: ['pending', 'retry_wait'] },
            $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: now } }],
          },
          {
            status: 'running',
            leaseExpiresAt: { $lte: now },
          },
        ],
      },
      {
        $set: {
          status: 'running',
          nextRetryAt: now,
          leaseOwner: workerId,
          leaseExpiresAt: nextLeaseExpiry,
        },
      },
      { returnDocument: 'after' },
    ).lean()
  },

  hasActiveRunningJobForCalendar: async (
    calendarConnectionId: string,
    jobType: 'full_sync' | 'incremental_sync',
    now: Date,
  ): Promise<boolean> => {
    if (!isValidObjectId(calendarConnectionId)) return false
    const exists = await GoogleSyncJobModel.exists({
      calendarConnectionId,
      jobType,
      status: 'running',
      leaseExpiresAt: { $gt: now },
    })
    return Boolean(exists)
  },

  extendJobLease: (jobId: unknown, workerId: string, leaseDurationMs: number) =>
    GoogleSyncJobModel.updateOne(
      { _id: jobId, leaseOwner: workerId, status: 'running' },
      { $set: { leaseExpiresAt: new Date(Date.now() + leaseDurationMs) } },
    ),

  findJobById: (jobId: unknown) => GoogleSyncJobModel.findById(jobId).lean(),

  updateJobById: (jobId: unknown, fields: Record<string, unknown>) =>
    GoogleSyncJobModel.findByIdAndUpdate(jobId, { $set: fields }, { returnDocument: 'after' }).lean(),

  findJobByIdForUser: (userId: string, jobId: string) => {
    if (!isValidObjectId(jobId)) return Promise.resolve(null)
    return GoogleSyncJobModel.findOne({ _id: jobId, userId }).lean()
  },

  findJobsByUserId: (userId: string) =>
    GoogleSyncJobModel.find({
      userId,
      status: { $in: ['pending', 'running', 'retry_wait', 'failed'] },
    })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean(),

  cancelPendingJobsForIntegration: (userId: string, integrationId: string) =>
    GoogleSyncJobModel.updateMany(
      {
        userId,
        integrationId,
        status: { $in: ['pending', 'retry_wait'] },
      },
      {
        $set: {
          status: 'cancelled',
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      },
    ),

  cancelPendingJobsForCalendar: (userId: string, calendarConnectionId: string) =>
    GoogleSyncJobModel.updateMany(
      {
        userId,
        calendarConnectionId,
        status: { $in: ['pending', 'retry_wait'] },
      },
      {
        $set: {
          status: 'cancelled',
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      },
    ),

  releaseWorkerLeases: (workerId: string) =>
    GoogleSyncJobModel.updateMany(
      { leaseOwner: workerId, status: 'running' },
      {
        $set: {
          status: 'retry_wait',
          leaseOwner: null,
          leaseExpiresAt: null,
          nextRetryAt: new Date(),
        },
      },
    ),
}
