import { randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { AppError } from '../../../shared/errors/app-error.js'
import { CalendarCategoryModel } from '../models/calendar-category.model.js'
import { EventModel } from '../models/event.model.js'
import { calendarRepository } from '../repositories/calendar.repository.js'
import { googleCalendarRepository } from '../repositories/google-calendar.repository.js'
import { wakeUpGoogleSyncWorker } from '@/jobs/google-sync-runner.js'
import { googleCalendarSyncService } from './google-calendar-sync.service.js'
import { UserModel } from '@/modules/auth/models/user.model.js'
import { NotificationModel } from '@/modules/notifications/models/notification.model.js'
import { notificationService } from '@/modules/notifications/services/notification.service.js'
import { sendCategorySharedEmail, sendEventInvitationEmail } from '@/modules/auth/services/email.service.js'
import type {
  CalendarCategoryResponse,
  CalendarEventResponse,
  EventJoinRequestItem,
  EventQueryFilters,
  GoogleEventSource,
  RecurrenceConfig,
  RecurrenceFrequency,
  ReminderItem,
  SharedEventPreviewResponse,
  SubtaskItem,
} from '../types/calendar.types.js'
import {
  validateCreateCategory,
  validateCreateEvent,
  validateUpdateCategory,
  validateUpdateEvent,
} from '../validations/calendar.validation.js'

interface RawCategoryDoc {
  _id: unknown
  userId: unknown
  name: string
  color: string
  settings?: CalendarCategoryResponse['settings']
  sharedWith?: CalendarCategoryResponse['sharedWith']
  description?: string
  isVisible?: boolean
  isDefault?: boolean
  createdAt?: Date
  updatedAt?: Date
}

interface RawPopulatedCategory {
  _id: unknown
  name: string
  color: string
  description?: string
  isVisible?: boolean
}

interface RawEventDoc {
  _id: unknown
  userId: unknown
  googleSource?: GoogleEventSource
  isGoogleReadOnly?: boolean
  syncOrigin?: 'local' | 'google'
  googleEventId?: string
  calendarId?: unknown
  entryType: 'event' | 'task'
  title: string
  description?: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  startDate: Date
  endDate: Date
  deadline?: Date | null
  isAllDay?: boolean
  location?: string
  onlineMeetingUrl?: string
  submissionUrl?: string
  color?: string
  availability?: 'busy' | 'free'
  visibility?: 'default' | 'public' | 'private'
  timeZone?: string
  guests?: CalendarEventResponse['guests']
  isCompleted?: boolean
  completedAt?: Date | null
  checklist?: SubtaskItem[]
  reminders?: ReminderItem[]
  recurrence?: {
    frequency: RecurrenceFrequency
    interval: number
    daysOfWeek?: number[]
    until?: Date | null
    count?: number | null
  }
  exceptionDates?: (Date | string)[]
  googleExceptionDates?: Date[]
  recurringEventId?: unknown
  originalStartDate?: Date | string | null
  createdAt?: Date
  updatedAt?: Date
}

const toDateKey = (date: Date | string, timeZone = 'Asia/Ho_Chi_Minh'): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(date))
  } catch {
    return new Date(date).toISOString().slice(0, 10)
  }
}

const resolveCategoryObjectId = (val: unknown): Types.ObjectId | null => {
  if (!val) return null
  if (val instanceof Types.ObjectId) return val
  if (typeof val === 'object' && '_id' in val) {
    const inner = (val as { _id: unknown })._id
    if (inner instanceof Types.ObjectId) return inner
    if (typeof inner === 'string' && Types.ObjectId.isValid(inner)) return new Types.ObjectId(inner)
  }
  if (typeof val === 'string' && Types.ObjectId.isValid(val)) {
    return new Types.ObjectId(val)
  }
  return null
}

const resolveActiveGuestAccount = async (
  rawIdentifier: string,
  creatorEmail?: string,
): Promise<{ email: string; fullName: string }> => {
  const identifier = rawIdentifier.trim().toLowerCase()
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const query = identifier.includes('@')
    ? { email: new RegExp(`^${escaped}$`, 'i') }
    : { username: new RegExp(`^${escaped}$`, 'i') }

  const found = await UserModel.findOne(query).select('email fullName status').lean()
  if (!found || !found.email) {
    throw new AppError(400, 'USER_NOT_FOUND', 'Không tìm thấy người dùng')
  }
  if (found.status !== 'active') {
    throw new AppError(
      400,
      'USER_NOT_ACTIVE',
      'Không thể mời người dùng chưa kích hoạt hoặc đang bị khóa',
    )
  }

  const resolvedEmail = found.email.trim().toLowerCase()
  if (creatorEmail && resolvedEmail === creatorEmail) {
    throw new AppError(400, 'CANNOT_INVITE_CREATOR', 'Không thể mời lại người tạo sự kiện.')
  }

  return {
    email: resolvedEmail,
    fullName: found.fullName || '',
  }
}

const getCategoryRole = (
  category: { userId: unknown; sharedWith?: Array<{ email?: string; role?: string }>; settings?: { sharedWith?: Array<{ email?: string; role?: string }> } },
  userId: string,
  userEmail?: string,
): 'owner' | 'admin' | 'editor' | 'viewer' | null => {
  if (String(category.userId) === userId) return 'owner'
  if (!userEmail) return null
  const cleanEmail = userEmail.trim().toLowerCase()
  const members = category.sharedWith ?? category.settings?.sharedWith ?? []
  const match = members.find((m) => m.email && m.email.trim().toLowerCase() === cleanEmail)
  if (!match) return null
  if (match.role === 'admin' || match.role === 'editor') return match.role
  return 'viewer'
}

const getEventCategoryRole = async (
  calendarId: unknown,
  userId: string,
  userEmail?: string,
): Promise<'owner' | 'admin' | 'editor' | 'viewer' | null> => {
  const catObjId = resolveCategoryObjectId(calendarId)
  if (!catObjId) return null
  const cat = await calendarRepository.findCategoryDocById(String(catObjId))
  if (!cat) return null
  return getCategoryRole(cat as unknown as RawCategoryDoc, userId, userEmail)
}

const resolveCategorySharedMembers = async (
  members: Array<{ email: string; role: 'viewer' | 'editor' | 'admin' }>,
  ownerEmail?: string,
): Promise<Array<{ email: string; role: 'viewer' | 'editor' | 'admin' }>> => {
  const seen = new Set<string>()
  const resolvedList: Array<{ email: string; role: 'viewer' | 'editor' | 'admin' }> = []
  for (const member of members) {
    const resolved = await resolveActiveGuestAccount(member.email, ownerEmail)
    if (!seen.has(resolved.email)) {
      seen.add(resolved.email)
      resolvedList.push({
        email: resolved.email,
        role: member.role === 'admin' || member.role === 'editor' ? member.role : 'viewer',
      })
    }
  }
  return resolvedList
}

const notifyNewCategoryMembers = async (
  members: Array<{ email: string; role: 'viewer' | 'editor' | 'admin' }>,
  previousEmails: Set<string>,
  categoryName: string,
  sharerName: string,
  description?: string,
) => {
  const roleLabelMap: Record<'viewer' | 'editor' | 'admin', string> = {
    viewer: 'Chỉ xem',
    editor: 'Chỉnh sửa sự kiện',
    admin: 'Quản lý toàn diện',
  }
  for (const member of members) {
    const cleanEmail = member.email.trim().toLowerCase()
    if (previousEmails.has(cleanEmail)) continue
    const escaped = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const targetUser = await UserModel.findOne({
      email: new RegExp(`^${escaped}$`, 'i'),
      status: { $ne: 'locked' },
    }).lean()
    if (targetUser) {
      void notificationService.createNotification({
        userId: String(targetUser._id),
        type: 'calendar_shared',
        title: `Lịch được chia sẻ: ${categoryName}`,
        message: `${sharerName} đã chia sẻ lịch "${categoryName}" với bạn (quyền: ${roleLabelMap[member.role]}).`,
        link: '/calendar',
        metadata: {
          categoryName,
          role: member.role,
        },
      })
    }

    void sendCategorySharedEmail(cleanEmail, {
      categoryName,
      sharerName,
      roleLabel: roleLabelMap[member.role],
      description,
    })
  }
}

const mapCategoryResponse = (
  doc: RawCategoryDoc,
  userId?: string,
  userEmail?: string,
): CalendarCategoryResponse => {
  const role = userId ? getCategoryRole(doc, userId, userEmail) : null
  const subscribers = Array.isArray((doc as unknown as { subscribers?: unknown[] }).subscribers)
    ? (doc as unknown as { subscribers: unknown[] }).subscribers
    : []
  const isSubscribed = Boolean(!role && userId && subscribers.some((s) => String(s) === userId))
  const effectiveRole = role ?? (isSubscribed ? ('viewer' as const) : undefined)
  const sharedWith = doc.sharedWith ?? doc.settings?.sharedWith ?? []
  const rawToken = (doc as unknown as { publicToken?: string | null }).publicToken ?? null
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    name: doc.name,
    color: doc.color,
    settings: doc.settings,
    sharedWith: isSubscribed ? [] : sharedWith,
    isShared: (role !== null && role !== 'owner') || isSubscribed,
    isSubscribed,
    publicToken: doc.settings?.privacy === 'public' ? rawToken : null,
    myRole: effectiveRole,
    description: doc.description ?? '',
    isVisible: doc.isVisible ?? true,
    isDefault: Boolean(doc.isDefault),
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
  }
}

const mapEventResponse = (doc: RawEventDoc): CalendarEventResponse => {
  let calendarInfo: CalendarCategoryResponse | null = null
  let rawCalendarId: string | null = null

  let creatorInfo: { id: string; email: string; fullName: string } | undefined
  let rawUserId = ''

  if (doc.userId && typeof doc.userId === 'object' && '_id' in doc.userId) {
    const popUser = doc.userId as { _id: unknown; email?: string; fullName?: string }
    rawUserId = String(popUser._id)
    creatorInfo = {
      id: rawUserId,
      email: popUser.email ?? '',
      fullName: popUser.fullName ?? '',
    }
  } else if (doc.userId) {
    rawUserId = String(doc.userId)
  }

  if (doc.calendarId && typeof doc.calendarId === 'object' && '_id' in doc.calendarId) {
    const pop = doc.calendarId as RawPopulatedCategory
    rawCalendarId = String(pop._id)
    calendarInfo = {
      id: String(pop._id),
      userId: rawUserId,
      name: pop.name,
      color: pop.color,
      description: pop.description ?? '',
      isVisible: pop.isVisible ?? true,
      isDefault: false,
      createdAt: '',
      updatedAt: '',
    }
  } else if (doc.calendarId) {
    rawCalendarId = String(doc.calendarId)
  }

  let formattedRecurrence: RecurrenceConfig | undefined
  if (doc.recurrence && doc.recurrence.frequency !== 'none') {
    formattedRecurrence = {
      frequency: doc.recurrence.frequency,
      interval: doc.recurrence.interval,
      daysOfWeek: doc.recurrence.daysOfWeek,
      until: doc.recurrence.until ? doc.recurrence.until.toISOString() : null,
      count: doc.recurrence.count ?? null,
    }
  }

  return {
    id: String(doc._id),
    userId: rawUserId,
    creator: doc.googleSource ? undefined : creatorInfo,
    creatorEmail: doc.googleSource ? doc.googleSource.creator?.email ?? '' : creatorInfo?.email ?? '',
    googleSource: doc.googleSource ? {
      integrationId: doc.googleSource.integrationId ? String(doc.googleSource.integrationId) : undefined,
      calendarConnectionId: doc.googleSource.calendarConnectionId
        ? String(doc.googleSource.calendarConnectionId)
        : undefined,
      accountEmail: doc.googleSource.accountEmail,
      calendarName: doc.googleSource.calendarName,
      eventColorId: doc.googleSource.eventColorId,
      eventLabelId: doc.googleSource.eventLabelId,
      eventColor: doc.googleSource.eventColor,
      calendarColor: doc.googleSource.calendarColor,
      accessRole: doc.googleSource.accessRole,
      creator: doc.googleSource.creator,
      organizer: doc.googleSource.organizer,
    } : undefined,
    isGoogleReadOnly: Boolean(doc.isGoogleReadOnly),
    syncOrigin: doc.syncOrigin ?? 'local',
    hasGoogleMappings: Boolean(doc.googleEventId || doc.googleSource),
    calendarId: doc.googleSource ? null : rawCalendarId,
    calendar: doc.googleSource ? null : calendarInfo,
    entryType: doc.entryType,
    title: doc.title,
    description: doc.description ?? '',
    priority: doc.priority,
    startDate: doc.startDate.toISOString(),
    endDate: doc.endDate.toISOString(),
    deadline: doc.deadline ? doc.deadline.toISOString() : null,
    isAllDay: Boolean(doc.isAllDay),
    location: doc.location ?? '',
    onlineMeetingUrl: doc.onlineMeetingUrl ?? '',
    submissionUrl: doc.submissionUrl ?? '',
    inheritsCalendarColor:
      doc.entryType === 'event' &&
      (!doc.color ||
        Boolean(
          doc.googleSource &&
            !doc.googleSource.eventColorId &&
            !doc.googleSource.eventLabelId &&
            !doc.googleSource.eventColor &&
            doc.color.toLowerCase() === doc.googleSource.calendarColor.toLowerCase(),
        )),
    color:
      doc.color ||
      (doc.googleSource && (doc.googleSource.eventColor || doc.googleSource.calendarColor)) ||
      (doc.entryType === 'task'
        ? doc.priority === 'urgent'
          ? '#EF4444'
          : doc.priority === 'high'
            ? '#F59E0B'
            : doc.priority === 'low'
              ? '#64748B'
              : '#3B82F6'
        : calendarInfo
          ? calendarInfo.color
          : '#2563EB'),
    availability: doc.availability ?? 'busy',
    visibility: doc.visibility ?? 'default',
    timeZone: doc.timeZone ?? '',
    guests: Array.isArray(doc.guests) ? doc.guests : [],
    isCompleted: Boolean(doc.isCompleted),
    completedAt: doc.completedAt ? doc.completedAt.toISOString() : null,
    checklist: Array.isArray(doc.checklist) ? doc.checklist : [],
    reminders: Array.isArray(doc.reminders) ? doc.reminders : [{ method: 'in-app', minutesBefore: 15 }],
    recurrence: formattedRecurrence,

    exceptionDates: [...new Set([
      ...(doc.exceptionDates ?? []),
      ...(doc.googleExceptionDates ?? []),
    ].map((date) => new Date(date).toISOString()))],
    shareToken: (doc as unknown as { shareToken?: string | null }).shareToken ?? null,
    isShareEnabled: Boolean((doc as unknown as { isShareEnabled?: boolean }).isShareEnabled),
    joinRequests: Array.isArray((doc as unknown as { joinRequests?: unknown[] }).joinRequests)
      ? ((doc as unknown as { joinRequests: Array<Record<string, unknown>> }).joinRequests).map((r) => ({
          id: String(r._id),
          userId: String(r.userId),
          email: String(r.email ?? ''),
          fullName: String(r.fullName ?? ''),
          message: String(r.message ?? ''),
          status: (r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending') as EventJoinRequestItem['status'],
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(String(r.createdAt ?? Date.now())).toISOString(),
          respondedAt: r.respondedAt instanceof Date ? r.respondedAt.toISOString() : r.respondedAt ? new Date(String(r.respondedAt)).toISOString() : null,
        }))
      : [],
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : new Date().toISOString(),
  }
}


export const calendarService = {
  getCategories: async (userId: string): Promise<CalendarCategoryResponse[]> => {
    await CalendarCategoryModel.deleteMany({
      userId,
      isDefault: true,
      name: { $in: ['🎓 Học chính khoá', 'Học chính khoá', '📝 Bài tập & Hạn chót', '💡 Tự học - Try hard', '🌟 Cá nhân & Hoạt động', 'Học tập'] },
    })

    const user = await UserModel.findById(userId).select('email').lean()
    const categories = await calendarRepository.findCategoriesByUserId(userId, user?.email)
    return categories.map((cat) => mapCategoryResponse(cat as unknown as RawCategoryDoc, userId, user?.email))
  },

  createCategory: async (userId: string, payload: unknown): Promise<CalendarCategoryResponse> => {
    const data = validateCreateCategory(payload)

    const existing = await calendarRepository.findCategoryByName(userId, data.name)
    if (existing) {
      throw new AppError(409, 'CATEGORY_EXISTS', 'Lịch này đã tồn tại trong danh sách của bạn', {
        name: 'Tên lịch đã tồn tại',
      })
    }

    const creator = await UserModel.findById(userId).select('email fullName').lean()
    const creatorEmail = creator?.email?.trim().toLowerCase()
    const creatorName = creator?.fullName || 'Người dùng EduTrack'

    if (data.sharedWith && data.sharedWith.length > 0) {
      const resolvedMembers = await resolveCategorySharedMembers(data.sharedWith, creatorEmail)
      data.sharedWith = resolvedMembers
      if (data.settings) {
        data.settings.sharedWith = resolvedMembers
      }
    }

    const created = await calendarRepository.createCategory(userId, data)
    if (data.settings?.privacy === 'public') {
      const publicToken = randomBytes(16).toString('base64url')
      await CalendarCategoryModel.updateOne({ _id: created._id }, { $set: { publicToken } })
      ;(created as unknown as { publicToken?: string }).publicToken = publicToken
    }
    if (data.sharedWith && data.sharedWith.length > 0) {
      void notifyNewCategoryMembers(data.sharedWith, new Set(), created.name, creatorName, created.description)
    }

    return mapCategoryResponse(created as unknown as RawCategoryDoc, userId, creatorEmail)
  },

  updateCategory: async (userId: string, categoryId: string, payload: unknown): Promise<CalendarCategoryResponse> => {
    const data = validateUpdateCategory(payload)
    const currentUser = await UserModel.findById(userId).select('email fullName').lean()
    const userEmail = currentUser?.email?.trim().toLowerCase()

    const existing = await calendarRepository.findCategoryDocById(categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const role = getCategoryRole(existing as unknown as RawCategoryDoc, userId, userEmail)
    if (!role) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    if (role !== 'owner' && role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền chỉnh sửa cấu hình lịch này')
    }

    const ownerId = String(existing.userId)
    if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await calendarRepository.findCategoryByName(ownerId, data.name)
      if (duplicate && String(duplicate._id) !== categoryId) {
        throw new AppError(409, 'CATEGORY_EXISTS', 'Tên lịch đã tồn tại', {
          name: 'Tên lịch đã tồn tại',
        })
      }
    }

    const owner = ownerId === userId
      ? currentUser
      : await UserModel.findById(ownerId).select('email fullName').lean()
    const ownerEmail = owner?.email?.trim().toLowerCase()
    const prevMembers = existing.sharedWith ?? existing.settings?.sharedWith ?? []
    const prevEmails = new Set(prevMembers.map((m) => (m.email || '').trim().toLowerCase()).filter(Boolean))

    if (data.sharedWith !== undefined) {
      const resolvedMembers = await resolveCategorySharedMembers(data.sharedWith, ownerEmail)
      data.sharedWith = resolvedMembers
      if (data.settings) {
        data.settings.sharedWith = resolvedMembers
      }
    }

    const updated = await calendarRepository.updateCategoryById(categoryId, data)
    if (!updated) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const existingToken = (existing as unknown as { publicToken?: string | null }).publicToken
    if (data.settings?.privacy === 'public' && !existingToken) {
      const publicToken = randomBytes(16).toString('base64url')
      await CalendarCategoryModel.updateOne({ _id: categoryId }, { $set: { publicToken } })
      ;(updated as unknown as { publicToken?: string }).publicToken = publicToken
    }

    if (data.sharedWith && data.sharedWith.length > 0) {
      const sharerName = currentUser?.fullName || 'Người dùng EduTrack'
      void notifyNewCategoryMembers(data.sharedWith, prevEmails, updated.name, sharerName, updated.description)
    }

    return mapCategoryResponse(updated as unknown as RawCategoryDoc, userId, userEmail)
  },

  toggleCategoryVisibility: async (
    userId: string,
    categoryId: string,
    isVisible: boolean,
  ): Promise<CalendarCategoryResponse> => {
    const existing = await calendarRepository.findCategoryById(userId, categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const updated = await calendarRepository.setCategoryVisibility(userId, categoryId, isVisible)
    if (!updated) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    return mapCategoryResponse(updated as unknown as RawCategoryDoc)
  },

  setOnlyCategoryVisible: async (
    userId: string,
    categoryId: string,
  ): Promise<CalendarCategoryResponse[]> => {
    const existing = await calendarRepository.findCategoryById(userId, categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    await calendarRepository.setOnlyCategoryVisible(userId, categoryId)
    const all = await calendarRepository.findCategoriesByUserId(userId)
    return all.map((cat) => mapCategoryResponse(cat as unknown as RawCategoryDoc))
  },

  setAllCategoriesVisibility: async (
    userId: string,
    isVisible: boolean,
  ): Promise<CalendarCategoryResponse[]> => {
    const all = await calendarRepository.setAllCategoriesVisibility(userId, isVisible)
    return all.map((cat) => mapCategoryResponse(cat as unknown as RawCategoryDoc))
  },

  deleteCategory: async (userId: string, categoryId: string): Promise<void> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    const existing = await calendarRepository.findCategoryDocById(categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const role = getCategoryRole(existing as unknown as RawCategoryDoc, userId, user?.email)
    if (!role) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    if (role !== 'owner') {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ chủ sở hữu mới có quyền xóa vĩnh viễn lịch này')
    }

    await calendarRepository.deleteCategory(userId, categoryId)

    const members = existing.sharedWith ?? existing.settings?.sharedWith ?? []
    const ownerName = user?.fullName || 'Chủ sở hữu lịch'
    for (const member of members) {
      const cleanEmail = (member.email || '').trim().toLowerCase()
      if (!cleanEmail) continue
      const escaped = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const targetUser = await UserModel.findOne({
        email: new RegExp(`^${escaped}$`, 'i'),
        status: { $ne: 'locked' },
      }).lean()
      if (targetUser) {
        void notificationService.createNotification({
          userId: String(targetUser._id),
          type: 'calendar_shared',
          title: `Lịch đã bị xóa: ${existing.name}`,
          message: `${ownerName} đã xóa vĩnh viễn lịch "${existing.name}" và các sự kiện thuộc lịch này.`,
          link: '/calendar',
          metadata: {
            categoryId,
            categoryName: existing.name,
            deletedByEmail: user?.email,
          },
        })
      }
    }
  },

  leaveCategory: async (userId: string, categoryId: string): Promise<void> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    const userEmail = user?.email?.trim().toLowerCase()
    if (!userEmail) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy thông tin tài khoản')
    }

    const existing = await calendarRepository.findCategoryDocById(categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const role = getCategoryRole(existing as unknown as RawCategoryDoc, userId, userEmail)
    if (!role) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Bạn không nằm trong danh sách chia sẻ của lịch này')
    }
    if (role === 'owner') {
      throw new AppError(400, 'CANNOT_LEAVE_OWN_CATEGORY', 'Chủ sở hữu không thể rời khỏi lịch của chính mình')
    }

    await calendarRepository.leaveCategory(categoryId, userEmail)

    const leaverName = user?.fullName || userEmail
    void notificationService.createNotification({
      userId: String(existing.userId),
      type: 'calendar_shared',
      title: `Thành viên đã rời lịch: ${existing.name}`,
      message: `${leaverName} (${userEmail}) đã rời khỏi lịch "${existing.name}".`,
      link: '/calendar',
      metadata: {
        categoryId,
        categoryName: existing.name,
        leftByEmail: userEmail,
      },
    })
  },

  resolveGuestCandidate: async (
    userId: string,
    rawIdentifier: string,
  ): Promise<{ email: string; fullName: string }> => {
    const cleanIdentifier = rawIdentifier.trim().toLowerCase()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const usernameRegex = /^[a-zA-Z0-9._-]{3,40}$/

    if (!cleanIdentifier) {
      throw new AppError(400, 'GUEST_IDENTIFIER_REQUIRED', 'Vui lòng nhập email hoặc username khách mời')
    }
    if (!emailRegex.test(cleanIdentifier) && !usernameRegex.test(cleanIdentifier)) {
      throw new AppError(
        400,
        'GUEST_IDENTIFIER_INVALID',
        'Email hoặc username không đúng định dạng (username từ 3 đến 40 ký tự)',
      )
    }

    const currentUser = await UserModel.findById(userId).select('email').lean()
    const selfEmail = currentUser?.email?.trim().toLowerCase()
    const resolved = await resolveActiveGuestAccount(cleanIdentifier)

    if (selfEmail && resolved.email === selfEmail) {
      throw new AppError(400, 'CANNOT_INVITE_SELF', 'Bạn không thể tự mời chính mình')
    }

    return resolved
  },

  getEvents: async (userId: string, filters: EventQueryFilters = {}): Promise<CalendarEventResponse[]> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    const userEmail = user?.email?.trim().toLowerCase()
    const events = await calendarRepository.findEvents(userId, user?.email, filters)

    const subscribedDocs = await CalendarCategoryModel.find({
      subscribers: userId,
      'settings.privacy': 'public',
    })
      .select('_id userId sharedWith settings.sharedWith')
      .lean()
    const subscribedOnlyCatIds = new Set(
      subscribedDocs
        .filter((cat) => {
          const role = getCategoryRole(cat as unknown as RawCategoryDoc, userId, userEmail)
          return role === null
        })
        .map((cat) => String(cat._id)),
    )

    const results: CalendarEventResponse[] = []
    for (const item of events) {
      const mapped = mapEventResponse(item as unknown as RawEventDoc)
      const isSubscriberOnly =
        Boolean(mapped.calendarId && subscribedOnlyCatIds.has(mapped.calendarId)) &&
        mapped.userId !== userId &&
        !(mapped.guests ?? []).some((g) => Boolean(userEmail && g.email.toLowerCase() === userEmail))

      if (isSubscriberOnly && mapped.visibility === 'private') {
        continue
      }
      results.push(mapped)
    }
    return results
  },

  getEventById: async (userId: string, eventId: string): Promise<CalendarEventResponse> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    const event = await calendarRepository.findEventById(userId, eventId, user?.email)
    if (!event) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    return mapEventResponse(event as unknown as RawEventDoc)
  },

  createEvent: async (userId: string, payload: unknown): Promise<CalendarEventResponse> => {
    const data = validateCreateEvent(payload)

    const creator = await UserModel.findById(userId).select('email fullName').lean()
    const creatorEmail = creator?.email?.trim().toLowerCase()

    if (data.calendarId) {
      const category = await calendarRepository.findCategoryDocById(data.calendarId)
      if (!category) {
        throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
      }
      const catRole = getCategoryRole(category as unknown as RawCategoryDoc, userId, creatorEmail)
      if (!catRole) {
        throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
      }
      if (catRole === 'viewer') {
        throw new AppError(403, 'FORBIDDEN', 'Bạn chỉ có quyền xem lịch này, không thể thêm sự kiện')
      }
      if (data.visibility === 'public' && (category.settings?.privacy !== 'public' || data.entryType === 'task')) {
        data.visibility = data.entryType === 'task' ? 'private' : 'default'
      }
    } else if (data.visibility === 'public') {
      data.visibility = data.entryType === 'task' ? 'private' : 'default'
    }

    if (data.guests && data.guests.length > 0) {
      const seenEmails = new Set<string>()
      const resolvedGuests: typeof data.guests = []
      for (const guest of data.guests) {
        const resolved = await resolveActiveGuestAccount(guest.email, creatorEmail)
        if (!seenEmails.has(resolved.email)) {
          seenEmails.add(resolved.email)
          resolvedGuests.push({ ...guest, email: resolved.email })
        }
      }
      data.guests = resolvedGuests
    }

    if (!data.calendarId && data.entryType === 'task' && !data.color) {
      const priorityColorMap: Record<string, string> = {
        urgent: '#EF4444',
        high: '#F59E0B',
        medium: '#3B82F6',
        low: '#64748B',
      }
      data.color = (data.priority && priorityColorMap[data.priority]) || '#3B82F6'
    }

    const created = await calendarRepository.createEvent(userId, data)
    const populated = await calendarRepository.findEventById(userId, String(created._id))
    const result = mapEventResponse((populated ?? created) as unknown as RawEventDoc)

    if (data.guests && data.guests.length > 0) {
      const creatorName = creator?.fullName || 'Người dùng EduTrack'

      for (const guest of data.guests) {
        const cleanEmail = guest.email.trim().toLowerCase()
        if (creatorEmail && cleanEmail === creatorEmail) {
          continue
        }

        const escaped = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const targetUser = await UserModel.findOne({
          email: new RegExp(`^${escaped}$`, 'i'),
          status: { $ne: 'locked' },
        }).lean()

        if (targetUser) {
          void notificationService.createNotification({
            userId: String(targetUser._id),
            type: 'event_invitation',
            title: `Lời mời tham gia sự kiện: ${result.title}`,
            message: `${creatorName} đã mời bạn tham gia sự kiện "${result.title}".`,
            eventId: result.id,
            link: '/calendar',
            metadata: {
              status: 'pending',
              startDate: result.startDate,
              location: result.location,
            },
          })
        }

        void sendEventInvitationEmail(cleanEmail, {
          title: result.title,
          creatorName,
          startDate: new Date(result.startDate),
          endDate: new Date(result.endDate),
          location: result.location,
          onlineMeetingUrl: result.onlineMeetingUrl,
          description: result.description,
        })
      }
    }

    if (result.entryType === 'event') {
      void googleCalendarSyncService.enqueueLocalEventPush(userId, result.id).then(() => {
        wakeUpGoogleSyncWorker()
      })
    }

    return result
  },

  updateEvent: async (userId: string, eventId: string, payload: unknown): Promise<CalendarEventResponse> => {
    let data = validateUpdateEvent(payload)
    const user = await UserModel.findById(userId).select('email fullName').lean()

    const existing = await calendarRepository.findEventById(userId, eventId, user?.email)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    if (existing.isGoogleReadOnly) {
      throw new AppError(
        403,
        'EVENT_READ_ONLY',
        'Sự kiện từ Google Calendar này chỉ có quyền xem, không thể chỉnh sửa.',
      )
    }
    if (existing.syncOrigin === 'google') {
      const editableCount = await googleCalendarRepository.countEditableMappingsForEvent(existing._id)
      if (editableCount === 0) {
        throw new AppError(
          403,
          'EVENT_READ_ONLY',
          'Bạn không còn quyền chỉnh sửa sự kiện này trên Google Calendar.',
        )
      }
    }

    const rawOwnerId =
      existing.userId && typeof existing.userId === 'object' && '_id' in existing.userId
        ? String((existing.userId as { _id: unknown })._id)
        : String(existing.userId)
    const isOwner = rawOwnerId === userId

    const creator = await UserModel.findById(rawOwnerId).select('email fullName').lean()
    const creatorEmail = creator?.email?.trim().toLowerCase()

    const categoryRole = await getEventCategoryRole(existing.calendarId, userId, user?.email)
    const isCategoryEditor = categoryRole === 'owner' || categoryRole === 'admin' || categoryRole === 'editor'

    if (!isOwner && !isCategoryEditor) {
      const currentGuest = existing.guests?.find(
        (g) => Boolean(user?.email && g.email.toLowerCase() === user.email.toLowerCase()),
      )
      if (!currentGuest) {
        throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền thao tác trên sự kiện này')
      }

      if (!currentGuest.canModify) {
        if (!currentGuest.canInviteOthers) {
          throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền chỉnh sửa sự kiện này')
        }
        data = { guests: data.guests }
      } else {
        delete data.calendarId
      }
    } else if (!isOwner && isCategoryEditor) {
      if (data.calendarId !== undefined) {
        const nextCatId = data.calendarId ? String(data.calendarId) : ''
        const prevCatId = resolveCategoryObjectId(existing.calendarId)
        if (nextCatId !== (prevCatId ? String(prevCatId) : '')) {
          if (!nextCatId) {
            delete data.calendarId
          } else {
            const nextRole = await getEventCategoryRole(nextCatId, userId, user?.email)
            if (nextRole !== 'owner' && nextRole !== 'admin' && nextRole !== 'editor') {
              throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền chuyển sự kiện sang lịch này')
            }
          }
        }
      }
    }

    if (data.guests && data.guests.length > 0) {
      const oldEmails = new Set((existing.guests || []).map((g) => g.email.trim().toLowerCase()))
      const seenEmails = new Set<string>()
      const resolvedGuests: typeof data.guests = []

      for (const guest of data.guests) {
        const identifier = guest.email.trim().toLowerCase()
        if (oldEmails.has(identifier)) {
          if (creatorEmail && identifier === creatorEmail) {
            throw new AppError(400, 'CANNOT_INVITE_CREATOR', 'Không thể mời lại người tạo sự kiện.')
          }
          if (!seenEmails.has(identifier)) {
            seenEmails.add(identifier)
            resolvedGuests.push({ ...guest, email: identifier })
          }
        } else {
          const resolved = await resolveActiveGuestAccount(identifier, creatorEmail)
          if (!seenEmails.has(resolved.email)) {
            seenEmails.add(resolved.email)
            resolvedGuests.push({ ...guest, email: resolved.email })
          }
        }
      }
      data.guests = resolvedGuests
    }

    if (data.guests && creatorEmail) {
      const hasCreatorAsGuest = data.guests.some(
        (g) => g.email.trim().toLowerCase() === creatorEmail,
      )
      if (hasCreatorAsGuest) {
        throw new AppError(400, 'CANNOT_INVITE_CREATOR', 'Không thể mời lại người tạo sự kiện.')
      }
    }

    if (!isOwner && !isCategoryEditor && data.guests && existing.guests) {
      const existingGuestMap = new Map(
        existing.guests.map((g) => [g.email.toLowerCase(), g]),
      )

      data.guests = data.guests.map((g) => {
        const cleanEmail = g.email.trim().toLowerCase()
        const old = existingGuestMap.get(cleanEmail)
        if (old) {
          return {
            ...old,
            email: cleanEmail,
            role: old.role,
            canModify: old.canModify,
            canInviteOthers: old.canInviteOthers,
            canSeeGuestList: old.canSeeGuestList,
            status: old.status,
          }
        }
        return {
          email: cleanEmail,
          role: 'viewer',
          canModify: false,
          canInviteOthers: true,
          canSeeGuestList: true,
          status: 'pending',
        }
      })
    }

    const mode = data.mode
    const targetDateStr = data.targetDate
    delete data.mode
    delete data.targetDate

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)
      const baseStart = new Date(existing.startDate)
      const origDuration = Math.max(0, new Date(existing.endDate).getTime() - baseStart.getTime())
      const eventZone = data.timeZone || existing.timeZone || 'Asia/Ho_Chi_Minh'
      const targetDateKey = toDateKey(targetDate, eventZone)
      const baseStartKey = toDateKey(baseStart, eventZone)
      const resolvedCalendarId =
        data.calendarId !== undefined
          ? resolveCategoryObjectId(data.calendarId)
          : resolveCategoryObjectId(existing.calendarId)
      const resolvedDeadline =
        data.deadline !== undefined
          ? data.deadline
            ? new Date(data.deadline)
            : null
          : existing.deadline
            ? new Date(existing.deadline)
            : null

      if (mode === 'this') {
        await EventModel.updateOne(
          { _id: eventId },
          { $addToSet: { exceptionDates: targetDate } },
        )

        const rawEventData = {
          userId: new Types.ObjectId(rawOwnerId),
          calendarId: resolvedCalendarId,
          entryType: data.entryType || existing.entryType,
          title: data.title || existing.title,
          description: data.description !== undefined ? data.description : (existing.description ?? ''),
          priority: data.priority || existing.priority,
          startDate: data.startDate ? new Date(data.startDate) : targetDate,
          endDate: data.endDate ? new Date(data.endDate) : new Date(targetDate.getTime() + origDuration),
          deadline: resolvedDeadline,
          isAllDay: data.isAllDay !== undefined ? data.isAllDay : existing.isAllDay,
          location: data.location !== undefined ? data.location : (existing.location ?? ''),
          onlineMeetingUrl:
            data.onlineMeetingUrl !== undefined ? data.onlineMeetingUrl : (existing.onlineMeetingUrl ?? ''),
          submissionUrl: data.submissionUrl !== undefined ? data.submissionUrl : (existing.submissionUrl ?? ''),
          color: data.color ?? existing.color,
          availability: data.availability || existing.availability,
          visibility: data.visibility || existing.visibility,
          timeZone: data.timeZone ?? existing.timeZone,
          guests: data.guests || existing.guests,
          checklist: data.checklist || existing.checklist,
          reminders: data.reminders || existing.reminders,
          recurrence: { frequency: 'none' as const, interval: 1, daysOfWeek: [], until: null, count: null },
          exceptionDates: [],
          recurringEventId: new Types.ObjectId(eventId),
          originalStartDate: targetDate,
          ...(existing.googleSource ? { googleSource: existing.googleSource } : {}),
          ...(existing.syncOrigin ? { syncOrigin: existing.syncOrigin } : {}),
          ...(existing.googleCalendarId ? { googleCalendarId: existing.googleCalendarId } : {}),
          remindersSent: [],
        }

        const createdStandalone = await EventModel.create(rawEventData)
        const populated = await calendarRepository.findEventById(
          rawOwnerId,
          String(createdStandalone._id),
          user?.email,
        )
        const standaloneResult = mapEventResponse((populated ?? createdStandalone) as unknown as RawEventDoc)
        if (standaloneResult.entryType === 'event') {
          const pushNewPromise = existing.syncOrigin === 'google'
            ? googleCalendarSyncService.enqueueDetachedGoogleEventPush(
                rawOwnerId,
                eventId,
                standaloneResult.id,
              )
            : googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, standaloneResult.id)
          void Promise.all([
            googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, eventId),
            pushNewPromise,
          ]).then(() => {
            wakeUpGoogleSyncWorker()
          })
        }
        return standaloneResult
      }

      if (mode === 'following' && targetDateKey > baseStartKey) {
        const untilDate = new Date(targetDate.getTime() - 1000)
        const existingExceptions = Array.isArray(existing.exceptionDates)
          ? existing.exceptionDates.map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
          : []
        const pastExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) < targetDateKey)
        const futureExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) > targetDateKey)

        await EventModel.updateOne(
          { _id: eventId },
          {
            $set: {
              'recurrence.until': untilDate,
              'recurrence.count': null,
              exceptionDates: pastExceptions,
            },
          },
        )

        const newStart = data.startDate ? new Date(data.startDate) : targetDate
        const newEnd = data.endDate ? new Date(data.endDate) : new Date(newStart.getTime() + origDuration)

        const rawEventData = {
          userId: new Types.ObjectId(rawOwnerId),
          calendarId: resolvedCalendarId,
          entryType: data.entryType || existing.entryType,
          title: data.title || existing.title,
          description: data.description !== undefined ? data.description : (existing.description ?? ''),
          priority: data.priority || existing.priority,
          startDate: newStart,
          endDate: newEnd,
          deadline: resolvedDeadline,
          isAllDay: data.isAllDay !== undefined ? data.isAllDay : existing.isAllDay,
          location: data.location !== undefined ? data.location : (existing.location ?? ''),
          onlineMeetingUrl:
            data.onlineMeetingUrl !== undefined ? data.onlineMeetingUrl : (existing.onlineMeetingUrl ?? ''),
          submissionUrl: data.submissionUrl !== undefined ? data.submissionUrl : (existing.submissionUrl ?? ''),
          color: data.color ?? existing.color,
          availability: data.availability || existing.availability,
          visibility: data.visibility || existing.visibility,
          timeZone: data.timeZone ?? existing.timeZone,
          guests: data.guests || existing.guests,
          checklist: data.checklist || existing.checklist,
          reminders: data.reminders || existing.reminders,
          recurrence: data.recurrence
            ? {
                frequency: data.recurrence.frequency,
                interval: data.recurrence.interval || 1,
                daysOfWeek: data.recurrence.daysOfWeek || [],
                until: data.recurrence.until
                  ? new Date(data.recurrence.until)
                  : existing.recurrence.until
                    ? new Date(existing.recurrence.until)
                    : null,
                count: null,
              }
            : {
                frequency: (existing.recurrence.frequency || 'daily') as RecurrenceFrequency,
                interval: existing.recurrence.interval || 1,
                daysOfWeek: existing.recurrence.daysOfWeek || [],
                until: existing.recurrence.until ? new Date(existing.recurrence.until) : null,
                count: null,
              },
          exceptionDates: futureExceptions,
          ...(existing.googleSource ? { googleSource: existing.googleSource } : {}),
          ...(existing.syncOrigin ? { syncOrigin: existing.syncOrigin } : {}),
          ...(existing.googleCalendarId ? { googleCalendarId: existing.googleCalendarId } : {}),
          remindersSent: [],
        }

        const createdFollowing = await EventModel.create(rawEventData)
        await EventModel.updateMany(
          {
            userId: new Types.ObjectId(rawOwnerId),
            recurringEventId: new Types.ObjectId(eventId),
            originalStartDate: { $gte: targetDate },
          },
          { $set: { recurringEventId: createdFollowing._id } },
        )

        const populated = await calendarRepository.findEventById(
          rawOwnerId,
          String(createdFollowing._id),
          user?.email,
        )
        const followingResult = mapEventResponse((populated ?? createdFollowing) as unknown as RawEventDoc)
        if (followingResult.entryType === 'event') {
          const pushFollowingPromise = existing.syncOrigin === 'google'
            ? googleCalendarSyncService.enqueueDetachedGoogleEventPush(
                rawOwnerId,
                eventId,
                followingResult.id,
              )
            : googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, followingResult.id)
          void Promise.all([
            googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, eventId),
            pushFollowingPromise,
          ]).then(() => {
            wakeUpGoogleSyncWorker()
          })
        }
        return followingResult
      }

      if (mode === 'all_this_weekday') {
        const targetDow = targetDate.getDay()
        const existingDays =
          Array.isArray(existing.recurrence.daysOfWeek) && existing.recurrence.daysOfWeek.length > 0
            ? existing.recurrence.daysOfWeek
            : existing.recurrence.frequency === 'weekdays'
              ? [1, 2, 3, 4, 5]
              : []

        if (existingDays.includes(targetDow)) {
          const remainingDays = existingDays.filter((d: number) => d !== targetDow)
          if (remainingDays.length > 0) {
            await EventModel.updateOne(
              { _id: eventId },
              { $set: { 'recurrence.frequency': 'custom', 'recurrence.daysOfWeek': remainingDays } },
            )
          } else {
            await EventModel.deleteOne({ _id: eventId })
          }

          const newStart = data.startDate ? new Date(data.startDate) : targetDate
          const newDow = newStart.getDay()
          const newEnd = data.endDate ? new Date(data.endDate) : new Date(newStart.getTime() + origDuration)

          const rawEventData = {
            userId: new Types.ObjectId(rawOwnerId),
            calendarId: resolvedCalendarId,
            entryType: data.entryType || existing.entryType,
            title: data.title || existing.title,
            description: data.description !== undefined ? data.description : (existing.description ?? ''),
            priority: data.priority || existing.priority,
            startDate: newStart,
            endDate: newEnd,
            deadline: resolvedDeadline,
            isAllDay: data.isAllDay !== undefined ? data.isAllDay : existing.isAllDay,
            location: data.location !== undefined ? data.location : (existing.location ?? ''),
            onlineMeetingUrl:
              data.onlineMeetingUrl !== undefined ? data.onlineMeetingUrl : (existing.onlineMeetingUrl ?? ''),
            submissionUrl: data.submissionUrl !== undefined ? data.submissionUrl : (existing.submissionUrl ?? ''),
            color: data.color ?? existing.color,
            availability: data.availability || existing.availability,
            visibility: data.visibility || existing.visibility,
            timeZone: data.timeZone ?? existing.timeZone,
            guests: data.guests || existing.guests,
            checklist: data.checklist || existing.checklist,
            reminders: data.reminders || existing.reminders,
            recurrence: {
              frequency: 'custom' as const,
              interval: existing.recurrence.interval || 1,
              daysOfWeek: [newDow],
              until: existing.recurrence.until ? new Date(existing.recurrence.until) : null,
              count: null,
            },
            exceptionDates: [],
            ...(existing.googleSource ? { googleSource: existing.googleSource } : {}),
            ...(existing.syncOrigin ? { syncOrigin: existing.syncOrigin } : {}),
            ...(existing.googleCalendarId ? { googleCalendarId: existing.googleCalendarId } : {}),
            remindersSent: [],
          }

          const createdWeekdaySeries = await EventModel.create(rawEventData)
          const populated = await calendarRepository.findEventById(
            rawOwnerId,
            String(createdWeekdaySeries._id),
            user?.email,
          )
          const weekdayResult = mapEventResponse((populated ?? createdWeekdaySeries) as unknown as RawEventDoc)
          if (weekdayResult.entryType === 'event') {
            const pushWeekdayPromise = existing.syncOrigin === 'google'
              ? googleCalendarSyncService.enqueueDetachedGoogleEventPush(
                  rawOwnerId,
                  eventId,
                  weekdayResult.id,
                )
              : googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, weekdayResult.id)
            const pushTargets = remainingDays.length > 0
              ? [
                  googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, eventId),
                  pushWeekdayPromise,
                ]
              : [pushWeekdayPromise]
            void Promise.all(pushTargets).then(() => {
              wakeUpGoogleSyncWorker()
            })
          }
          return weekdayResult
        }
      }
    }

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && data.startDate && data.endDate) {
      const origBaseStart = new Date(existing.startDate)
      const newStart = new Date(data.startDate)
      const duration = Math.max(0, new Date(data.endDate).getTime() - newStart.getTime())

      const updatedBaseStart = new Date(origBaseStart)
      if (targetDateStr) {
        const dayDiff = Math.round((newStart.getTime() - new Date(targetDateStr).getTime()) / (24 * 3600 * 1000))
        if (dayDiff !== 0) {
          updatedBaseStart.setDate(updatedBaseStart.getDate() + dayDiff)
        }
      }
      updatedBaseStart.setHours(
        newStart.getHours(),
        newStart.getMinutes(),
        newStart.getSeconds(),
        newStart.getMilliseconds(),
      )
      const updatedBaseEnd = new Date(updatedBaseStart.getTime() + duration)

      data.startDate = updatedBaseStart.toISOString()
      data.endDate = updatedBaseEnd.toISOString()

      if (data.recurrence && data.recurrence.frequency === 'none') {
        data.exceptionDates = []
      }
    }

    let googleColorFields: Record<string, unknown> | undefined
    if (existing.googleSource && 'color' in data) {
      const nextColor = typeof data.color === 'string' ? data.color.trim() : ''
      const prevColor = typeof existing.color === 'string' ? existing.color.trim() : ''
      const colorChanged = nextColor.toLowerCase() !== prevColor.toLowerCase()
      if (!nextColor) {
        googleColorFields = {
          'googleSource.eventColorId': '',
          'googleSource.eventLabelId': '',
          'googleSource.eventColor': '',
        }
      } else if (colorChanged || !existing.googleSource.eventLabelId) {
        const { findClosestGoogleEventColorId } = await import('@/modules/calendar/services/google-calendar-mapper.js')
        googleColorFields = {
          'googleSource.eventColorId': findClosestGoogleEventColorId(nextColor),
          'googleSource.eventLabelId': '',
          'googleSource.eventColor': nextColor,
        }
      }
    }

    const updated = await calendarRepository.updateEvent(rawOwnerId, eventId, data, googleColorFields)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    const result = mapEventResponse(updated as unknown as RawEventDoc)

    if ((isOwner || isCategoryEditor) && data.guests && existing.guests) {
      for (const guest of data.guests) {
        const oldGuest = existing.guests.find(
          (og) => og.email.trim().toLowerCase() === guest.email.trim().toLowerCase(),
        )
        if (oldGuest && !oldGuest.canModify && guest.canModify) {
          const targetUser = await UserModel.findOne({
            email: new RegExp(`^${guest.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            status: { $ne: 'locked' },
          }).lean()

          if (targetUser) {
            void notificationService.createNotification({
              userId: String(targetUser._id),
              type: 'event_update',
              title: `Cập nhật quyền sự kiện: ${result.title}`,
              message: `${user?.fullName || 'Người tạo'} đã cấp quyền chỉnh sửa sự kiện "${result.title}" cho bạn.`,
              eventId: result.id,
              link: '/calendar',
            })
          }
        }
      }
    }

    if (!isOwner) {
      void notificationService.createNotification({
        userId: rawOwnerId,
        type: 'event_update',
        title: `Sự kiện đã được chỉnh sửa: ${result.title}`,
        message: `${user?.fullName || user?.email || 'Khách mời'} đã cập nhật nội dung sự kiện "${result.title}".`,
        eventId: result.id,
        link: '/calendar',
      })
    }

    if (data.guests && data.guests.length > 0) {
      const oldEmails = new Set((existing.guests || []).map((g) => g.email.toLowerCase()))
      const newGuests = data.guests.filter((g) => !oldEmails.has(g.email.toLowerCase()))
      const inviterName = user?.fullName || 'Người dùng EduTrack'

      for (const guest of newGuests) {
        const cleanEmail = guest.email.trim().toLowerCase()
        if (user?.email && cleanEmail === user.email.trim().toLowerCase()) continue
        if (creatorEmail && cleanEmail === creatorEmail) continue

        const escaped = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const targetUser = await UserModel.findOne({
          email: new RegExp(`^${escaped}$`, 'i'),
          status: { $ne: 'locked' },
        }).lean()

        if (targetUser) {
          void notificationService.createNotification({
            userId: String(targetUser._id),
            type: 'event_invitation',
            title: `Lời mời tham gia sự kiện: ${result.title}`,
            message: `${inviterName} đã mời bạn tham gia sự kiện "${result.title}".`,
            eventId: result.id,
            link: '/calendar',
            metadata: {
              status: 'pending',
              startDate: result.startDate,
              location: result.location,
            },
          })
        }

        void sendEventInvitationEmail(cleanEmail, {
          title: result.title,
          creatorName: inviterName,
          startDate: new Date(result.startDate),
          endDate: new Date(result.endDate),
          location: result.location,
          onlineMeetingUrl: result.onlineMeetingUrl,
          description: result.description,
        })
      }
    }

    if (result.entryType === 'event') {
      void googleCalendarSyncService.enqueueLocalEventPush(rawOwnerId, result.id).then(() => {
        wakeUpGoogleSyncWorker()
      })
    }

    return result
  },

  respondEventInvitation: async (
    userId: string,
    eventId: string,
    status: 'accepted' | 'declined',
  ): Promise<CalendarEventResponse> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    if (!user?.email) {
      throw new AppError(400, 'USER_EMAIL_MISSING', 'Không tìm thấy email của tài khoản.')
    }

    const updated = await calendarRepository.respondEventInvitation(eventId, user.email, status)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy lời mời sự kiện.')
    }

    const guestUserObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId
    const eventObjId = Types.ObjectId.isValid(eventId) ? new Types.ObjectId(eventId) : eventId
    await NotificationModel.updateMany(
      {
        $and: [
          { $or: [{ userId: guestUserObjId }, { userId }] },
          { $or: [{ eventId: eventObjId }, { eventId }] },
          { type: 'event_invitation' },
        ],
      },
      {
        $set: {
          isRead: true,
          'metadata.status': status,
        },
      },
    )

    const result = mapEventResponse(updated as unknown as RawEventDoc)

    const guestName = user.fullName || user.email
    const statusLabel = status === 'accepted' ? 'chấp nhận' : 'từ chối'
    const ownerId =
      updated.userId && typeof updated.userId === 'object' && '_id' in updated.userId
        ? String((updated.userId as { _id: unknown })._id)
        : String(updated.userId)

    void notificationService.createNotification({
      userId: ownerId,
      type: 'event_response',
      title: `Phản hồi lời mời: ${result.title}`,
      message: `${guestName} đã ${statusLabel} lời mời tham gia sự kiện "${result.title}".`,
      eventId: result.id,
      link: '/calendar',
    })

    return result
  },

  leaveEvent: async (userId: string, eventId: string): Promise<void> => {
    const user = await UserModel.findById(userId).select('email fullName').lean()
    if (!user?.email) {
      throw new AppError(400, 'USER_EMAIL_MISSING', 'Không tìm thấy email của tài khoản.')
    }

    const updated = await calendarRepository.leaveEvent(eventId, user.email)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện.')
    }

    const guestUserObjId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : userId
    const eventObjId = Types.ObjectId.isValid(eventId) ? new Types.ObjectId(eventId) : eventId
    await NotificationModel.updateMany(
      {
        $and: [
          { $or: [{ userId: guestUserObjId }, { userId }] },
          { $or: [{ eventId: eventObjId }, { eventId }] },
          { type: 'event_invitation' },
        ],
      },
      {
        $set: {
          isRead: true,
          'metadata.status': 'declined',
        },
      },
    )

    const guestName = user.fullName || user.email
    const ownerId =
      updated.userId && typeof updated.userId === 'object' && '_id' in updated.userId
        ? String((updated.userId as { _id: unknown })._id)
        : String(updated.userId)

    void notificationService.createNotification({
      userId: ownerId,
      type: 'event_update',
      title: `Rời khỏi sự kiện: ${updated.title}`,
      message: `${guestName} đã rời khỏi sự kiện "${updated.title}".`,
      eventId: String(updated._id),
      link: '/calendar',
    })
  },

  deleteEvent: async (
    userId: string,
    eventId: string,
    mode?: 'this' | 'following' | 'all',
    targetDateStr?: string,
    googleDeleteScope?: 'local_only' | 'both',
  ): Promise<void> => {
    const user = await UserModel.findById(userId).select('email').lean()
    const existing = await calendarRepository.findEventById(userId, eventId, user?.email)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }

    const rawOwnerId =
      existing.userId && typeof existing.userId === 'object' && '_id' in existing.userId
        ? String((existing.userId as { _id: unknown })._id)
        : String(existing.userId)
    const isOwner = rawOwnerId === userId
    const categoryRole = await getEventCategoryRole(existing.calendarId, userId, user?.email)
    const isCategoryEditor = categoryRole === 'owner' || categoryRole === 'admin' || categoryRole === 'editor'

    if (!isOwner && !isCategoryEditor) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền xóa sự kiện này')
        const activeMappings = (await googleCalendarRepository.findMappingsByEventId(userId, eventId))
      .filter((m) => m.status !== 'suppressed_local_delete')

    if (activeMappings.length > 0) {
      if (!googleDeleteScope) {
        throw new AppError(
          400,
          'GOOGLE_DELETE_SCOPE_REQUIRED',
          'Vui lòng chọn xóa chỉ trên EduTrack hoặc xóa trên cả Google Lịch.',
        )
      }
      if (googleDeleteScope === 'both' && existing.isGoogleReadOnly) {
        throw new AppError(
          403,
          'EVENT_READ_ONLY',
          'Sự kiện chỉ đọc từ Google Calendar không thể xóa trên Google.',
        )
      }
    }

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)
      const baseStart = new Date(existing.startDate)
      const eventZone = existing.timeZone || 'Asia/Ho_Chi_Minh'
      const targetDateKey = toDateKey(targetDate, eventZone)
      const baseStartKey = toDateKey(baseStart, eventZone)

      if (mode === 'this') {
        await EventModel.updateOne(
          { _id: eventId, userId },
          {
            $addToSet: {
              exceptionDates: targetDate,
              ...(googleDeleteScope === 'local_only' ? { googleExceptionDates: targetDate } : {}),
            },
          },
        )
        if (existing.entryType === 'event' && googleDeleteScope === 'both') {
          void googleCalendarSyncService.enqueueLocalEventPush(userId, eventId).then(() => {
            wakeUpGoogleSyncWorker()
          })
        }
        return
      }

      if (mode === 'following') {
        if (targetDateKey <= baseStartKey) {
          if (activeMappings.length > 0 && googleDeleteScope) {
            await googleCalendarSyncService.enqueueLocalEventDelete(userId, eventId, googleDeleteScope)
            wakeUpGoogleSyncWorker()
          }
          await calendarRepository.deleteEvent(userId, eventId)
          await EventModel.deleteMany({ userId, recurringEventId: eventId })
          return
        }
        const untilDate = new Date(targetDate.getTime() - 1000)
        const existingExceptions = Array.isArray(existing.exceptionDates)
          ? existing.exceptionDates.map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
          : []
        const pastExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) < targetDateKey)

        await EventModel.updateOne(
          { _id: eventId, userId: rawOwnerId },
          {
            $set: {
              'recurrence.until': untilDate,
              'recurrence.count': null,
              exceptionDates: pastExceptions,
            },
          },
        )
        await EventModel.deleteMany({
          userId: rawOwnerId,
          recurringEventId: eventId,
          originalStartDate: { $gte: targetDate },
        })
        if (existing.entryType === 'event' && googleDeleteScope === 'both') {
          void googleCalendarSyncService.enqueueLocalEventPush(userId, eventId).then(() => {
            wakeUpGoogleSyncWorker()
          })
        }
        return
      }
    }

    if (activeMappings.length > 0 && googleDeleteScope) {
      await googleCalendarSyncService.enqueueLocalEventDelete(userId, eventId, googleDeleteScope)
      wakeUpGoogleSyncWorker()
    }
    await calendarRepository.deleteEvent(userId, eventId)
    if (existing.recurrence && existing.recurrence.frequency !== 'none') {
      await EventModel.deleteMany({ userId: rawOwnerId, recurringEventId: eventId })
    }
  },

  toggleTaskComplete: async (
    userId: string,
    eventId: string,
    isCompleted: boolean,
    mode?: 'this' | 'following' | 'all',
    targetDateStr?: string,
  ): Promise<CalendarEventResponse> => {
    const user = await UserModel.findById(userId).select('email').lean()
    const existing = await calendarRepository.findEventById(userId, eventId, user?.email)
    if (!existing) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy nhiệm vụ yêu cầu')
    }

    const rawOwnerId =
      existing.userId && typeof existing.userId === 'object' && '_id' in existing.userId
        ? String((existing.userId as { _id: unknown })._id)
        : String(existing.userId)
    const isOwner = rawOwnerId === userId
    const categoryRole = await getEventCategoryRole(existing.calendarId, userId, user?.email)
    const isCategoryEditor = categoryRole === 'owner' || categoryRole === 'admin' || categoryRole === 'editor'
    const currentGuest = existing.guests?.find(
      (g) => Boolean(user?.email && g.email.toLowerCase() === user.email.toLowerCase()),
    )

    if (!isOwner && !isCategoryEditor && !currentGuest?.canModify) {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền cập nhật nhiệm vụ này')
    }

    if (existing.recurrence && existing.recurrence.frequency !== 'none' && mode && mode !== 'all' && targetDateStr) {
      const targetDate = new Date(targetDateStr)
      const baseStart = new Date(existing.startDate)
      const origDuration = Math.max(0, new Date(existing.endDate).getTime() - baseStart.getTime())
      const eventZone = existing.timeZone || 'Asia/Ho_Chi_Minh'
      const targetDateKey = toDateKey(targetDate, eventZone)
      const baseStartKey = toDateKey(baseStart, eventZone)
      const completedAt = isCompleted ? new Date() : null

      if (mode === 'this') {
        await EventModel.updateOne(
          { _id: eventId, userId: rawOwnerId },
          { $addToSet: { exceptionDates: targetDate } },
        )

        const createdStandalone = await EventModel.create({
          userId: new Types.ObjectId(rawOwnerId),
          calendarId: resolveCategoryObjectId(existing.calendarId),
          entryType: existing.entryType,
          title: existing.title,
          description: existing.description ?? '',
          priority: existing.priority,
          startDate: targetDate,
          endDate: new Date(targetDate.getTime() + origDuration),
          isAllDay: existing.isAllDay,
          location: existing.location ?? '',
          onlineMeetingUrl: existing.onlineMeetingUrl ?? '',
          submissionUrl: existing.submissionUrl ?? '',
          color: existing.color,
          availability: existing.availability,
          visibility: existing.visibility,
          timeZone: existing.timeZone,
          guests: existing.guests || [],
          checklist: existing.checklist || [],
          reminders: existing.reminders || [],
          isCompleted,
          completedAt,
          recurrence: { frequency: 'none' as const, interval: 1, daysOfWeek: [], until: null, count: null },
          exceptionDates: [],
          recurringEventId: new Types.ObjectId(eventId),
          originalStartDate: targetDate,
          remindersSent: [],
        })
        return mapEventResponse(createdStandalone as unknown as RawEventDoc)
      }

      if (mode === 'following' && targetDateKey > baseStartKey) {
        const untilDate = new Date(targetDate.getTime() - 1000)
        const existingExceptions = Array.isArray(existing.exceptionDates)
          ? existing.exceptionDates.map((d) => (d instanceof Date ? d : new Date(d as unknown as string)))
          : []
        const pastExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) < targetDateKey)
        const futureExceptions = existingExceptions.filter((ex) => toDateKey(ex, eventZone) > targetDateKey)

        await EventModel.updateOne(
          { _id: eventId, userId: rawOwnerId },
          {
            $set: {
              'recurrence.until': untilDate,
              'recurrence.count': null,
              exceptionDates: pastExceptions,
            },
          },
        )

        const createdFollowing = await EventModel.create({
          userId: new Types.ObjectId(rawOwnerId),
          calendarId: resolveCategoryObjectId(existing.calendarId),
          entryType: existing.entryType,
          title: existing.title,
          description: existing.description ?? '',
          priority: existing.priority,
          startDate: targetDate,
          endDate: new Date(targetDate.getTime() + origDuration),
          isAllDay: existing.isAllDay,
          location: existing.location ?? '',
          onlineMeetingUrl: existing.onlineMeetingUrl ?? '',
          submissionUrl: existing.submissionUrl ?? '',
          color: existing.color,
          availability: existing.availability,
          visibility: existing.visibility,
          timeZone: existing.timeZone,
          guests: existing.guests || [],
          checklist: existing.checklist || [],
          reminders: existing.reminders || [],
          isCompleted,
          completedAt,
          recurrence: {
            frequency: (existing.recurrence.frequency || 'daily') as RecurrenceFrequency,
            interval: existing.recurrence.interval || 1,
            daysOfWeek: existing.recurrence.daysOfWeek || [],
            until: existing.recurrence.until ? new Date(existing.recurrence.until) : null,
            count: null,
          },
          exceptionDates: futureExceptions,
          remindersSent: [],
        })

        await EventModel.updateMany(
          {
            userId: new Types.ObjectId(rawOwnerId),
            recurringEventId: new Types.ObjectId(eventId),
            originalStartDate: { $gte: targetDate },
          },
          { $set: { recurringEventId: createdFollowing._id } },
        )

        return mapEventResponse(createdFollowing as unknown as RawEventDoc)
      }
    }

    const updated = await calendarRepository.toggleTaskComplete(rawOwnerId, eventId, isCompleted)
    if (!updated) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy nhiệm vụ yêu cầu')
    }

    return mapEventResponse(updated as unknown as RawEventDoc)
  },

  exportCategoryIcs: async (userId: string, categoryId: string): Promise<{ icsContent: string; filename: string }> => {
    const user = await UserModel.findById(userId).select('email').lean()
    const category = await calendarRepository.findCategoryDocById(categoryId)
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    const role = getCategoryRole(category as unknown as RawCategoryDoc, userId, user?.email)
    if (!role) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }

    const events = await calendarRepository.findEventsByCategoryId(categoryId)
    const mappedEvents = events.map((item) => mapEventResponse(item as unknown as RawEventDoc))

    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
    const formatIcsDate = (dateStr: string, isAllDay: boolean) => {
      const d = new Date(dateStr)
      if (isAllDay) {
        return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
      }
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    }

    const escapeIcs = (str: string) => str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EduTrack//Calendar Module//VI',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcs(category.name)}`,
    ]

    if (category.description) {
      lines.push(`X-WR-CALDESC:${escapeIcs(category.description)}`)
    }
    if (category.settings?.timeZone) {
      lines.push(`X-WR-TIMEZONE:${category.settings.timeZone}`)
    }

    for (const event of mappedEvents) {
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:edutrack-${event.id}@edutrack.app`)
      lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString(), false)}`)
      if (event.isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.startDate, true)}`)
        lines.push(`DTEND;VALUE=DATE:${formatIcsDate(event.endDate, true)}`)
      } else {
        lines.push(`DTSTART:${formatIcsDate(event.startDate, false)}`)
        lines.push(`DTEND:${formatIcsDate(event.endDate, false)}`)
      }
      lines.push(`SUMMARY:${escapeIcs(event.title)}`)
      if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`)
      if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`)
      lines.push('END:VEVENT')
    }

    lines.push('END:VCALENDAR')
    const icsContent = lines.join('\r\n')
    const cleanFilename = category.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'calendar'
    return { icsContent, filename: `${cleanFilename}.ics` }
  },

  importCategoryIcs: async (
    userId: string,
    categoryId: string,
    rawIcsContent: string,
  ): Promise<{ importedCount: number }> => {
    const user = await UserModel.findById(userId).select('email').lean()
    const category = await calendarRepository.findCategoryDocById(categoryId)
    if (!category) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    const role = getCategoryRole(category as unknown as RawCategoryDoc, userId, user?.email)
    if (!role) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    if (role === 'viewer') {
      throw new AppError(403, 'FORBIDDEN', 'Bạn chỉ có quyền xem lịch này, không thể nhập sự kiện từ file .ics')
    }

    if (!rawIcsContent || typeof rawIcsContent !== 'string') {
      throw new AppError(400, 'INVALID_ICS_CONTENT', 'Nội dung file .ics không hợp lệ hoặc rỗng')
    }

    const unfolded = rawIcsContent.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
    const lines = unfolded.split(/\r?\n/)
    const parsedEvents: Array<{
      title: string
      description: string
      startDate: Date
      endDate: Date
      location: string
      isAllDay: boolean
    }> = []

    let inEvent = false
    let currentEvent: Record<string, string> = {}

    const unescapeIcs = (str: string) =>
      str.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')

    const parseIcsDate = (val: string): { date: Date; isAllDay: boolean } | null => {
      const clean = val.trim()
      const dateMatch = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
      if (!dateMatch) {
        const d = new Date(clean)
        if (!Number.isNaN(d.getTime())) {
          return { date: d, isAllDay: false }
        }
        return null
      }
      const [, y, m, d, h, min, s, z] = dateMatch
      if (h !== undefined) {
        if (z) {
          return {
            date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s || 0))),
            isAllDay: false,
          }
        }
        return {
          date: new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s || 0)),
          isAllDay: false,
        }
      }
      return {
        date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)),
        isAllDay: true,
      }
    }

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === 'BEGIN:VEVENT') {
        inEvent = true
        currentEvent = {}
        continue
      }
      if (trimmed === 'END:VEVENT') {
        if (inEvent && (currentEvent.SUMMARY || currentEvent.DTSTART)) {
          const startInfo = currentEvent.DTSTART ? parseIcsDate(currentEvent.DTSTART) : null
          let endInfo = currentEvent.DTEND ? parseIcsDate(currentEvent.DTEND) : null
          if (startInfo) {
            if (!endInfo) {
              endInfo = {
                date: new Date(startInfo.date.getTime() + 60 * 60 * 1000),
                isAllDay: startInfo.isAllDay,
              }
            }
            const rawTitle = currentEvent.SUMMARY ? unescapeIcs(currentEvent.SUMMARY).trim() : ''
            parsedEvents.push({
              title: (rawTitle || 'Không có tiêu đề').slice(0, 150),
              description: currentEvent.DESCRIPTION ? unescapeIcs(currentEvent.DESCRIPTION).slice(0, 2000) : '',
              startDate: startInfo.date,
              endDate: endInfo.date,
              location: currentEvent.LOCATION ? unescapeIcs(currentEvent.LOCATION).slice(0, 200) : '',
              isAllDay: startInfo.isAllDay,
            })
          }
        }
        inEvent = false
        currentEvent = {}
        continue
      }
      if (inEvent) {
        const colonIndex = trimmed.indexOf(':')
        if (colonIndex > 0) {
          const propFull = trimmed.slice(0, colonIndex)
          const propValue = trimmed.slice(colonIndex + 1)
          const propName = propFull.split(';')[0]?.toUpperCase() ?? ''
          if (propName) {
            currentEvent[propName] = propValue
          }
        }
      }
    }

    if (parsedEvents.length === 0) {
      throw new AppError(400, 'NO_EVENTS_FOUND', 'Không tìm thấy sự kiện nào trong file .ics')
    }

    const docsToInsert = parsedEvents.map((pe) => ({
      userId,
      calendarId: category._id,
      entryType: 'event' as const,
      title: pe.title,
      description: pe.description,
      priority: 'medium' as const,
      startDate: pe.startDate,
      endDate: pe.endDate,
      isAllDay: pe.isAllDay,
      location: pe.location,
      color: '',
      availability: 'busy' as const,
      visibility: 'default' as const,
      isCompleted: false,
    }))

    await EventModel.insertMany(docsToInsert)
    return { importedCount: docsToInsert.length }
  },

  enableEventShare: async (
    userId: string,
    eventId: string,
    regenerate = false,
  ): Promise<{ shareToken: string; isShareEnabled: boolean }> => {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    const event = await EventModel.findById(eventId)
    if (!event) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    if (String(event.userId) !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ người tạo sự kiện mới có quyền chia sẻ liên kết')
    }
    if (event.entryType !== 'event') {
      throw new AppError(400, 'INVALID_ENTRY_TYPE', 'Chỉ hỗ trợ chia sẻ liên kết cho sự kiện')
    }

    const token = !event.shareToken || regenerate ? randomBytes(18).toString('base64url') : event.shareToken
    event.shareToken = token
    event.isShareEnabled = true
    await event.save()

    return { shareToken: token, isShareEnabled: true }
  },

  revokeEventShare: async (userId: string, eventId: string): Promise<void> => {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    const event = await EventModel.findById(eventId)
    if (!event) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    if (String(event.userId) !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ người tạo sự kiện mới có quyền thu hồi liên kết')
    }

    event.isShareEnabled = false
    event.shareToken = null
    await event.save()
  },

  getSharedEventByToken: async (
    userId: string,
    shareToken: string,
  ): Promise<SharedEventPreviewResponse> => {
    const cleanToken = shareToken.trim()
    if (!cleanToken) {
      throw new AppError(404, 'SHARED_EVENT_NOT_FOUND', 'Sự kiện không còn tồn tại hoặc liên kết đã hết hiệu lực')
    }

    const event = await EventModel.findOne({
      shareToken: cleanToken,
      isShareEnabled: true,
      entryType: 'event',
    })
      .populate('userId', 'fullName')
      .populate('calendarId', 'color')
      .lean()

    if (!event) {
      throw new AppError(404, 'SHARED_EVENT_NOT_FOUND', 'Sự kiện không còn tồn tại hoặc liên kết đã hết hiệu lực')
    }

    const viewer = await UserModel.findById(userId).select('email').lean()
    const viewerEmail = viewer?.email?.trim().toLowerCase() ?? ''

    const ownerPop =
      event.userId && typeof event.userId === 'object' && '_id' in event.userId
        ? (event.userId as { _id: unknown; fullName?: string })
        : null
    const ownerId = ownerPop ? String(ownerPop._id) : String(event.userId)
    const creatorName = ownerPop?.fullName || 'Người dùng EduTrack'

    const calColor =
      event.calendarId && typeof event.calendarId === 'object' && 'color' in event.calendarId
        ? String((event.calendarId as { color?: string }).color || '#2563EB')
        : '#2563EB'

    let viewerStatus: SharedEventPreviewResponse['viewerStatus'] = 'none'
    let myRequestId: string | undefined

    if (ownerId === userId) {
      viewerStatus = 'owner'
    } else {
      const matchedGuest = (event.guests || []).find(
        (g) => Boolean(viewerEmail && g.email.trim().toLowerCase() === viewerEmail),
      )
      if (matchedGuest?.status === 'accepted') {
        viewerStatus = 'accepted'
      } else if (matchedGuest?.status === 'pending') {
        viewerStatus = 'pending_invite'
      } else {
        const requests = Array.isArray(event.joinRequests) ? event.joinRequests : []
        const pendingReq = requests.find(
          (r) => String(r.userId) === userId && r.status === 'pending',
        )
        if (pendingReq) {
          viewerStatus = 'pending_request'
          myRequestId = String(pendingReq._id)
        } else if (requests.some((r) => String(r.userId) === userId && r.status === 'rejected')) {
          viewerStatus = 'rejected'
        }
      }
    }

    return {
      id: String(event._id),
      title: event.title,
      description: event.description ?? '',
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      isAllDay: Boolean(event.isAllDay),
      location: event.location ?? '',
      onlineMeetingUrl: event.onlineMeetingUrl ?? '',
      color: event.color || calColor,
      timeZone: event.timeZone ?? '',
      creator: { id: ownerId, fullName: creatorName },
      recurrence: event.recurrence
        ? {
            frequency: event.recurrence.frequency as RecurrenceFrequency,
            interval: event.recurrence.interval ?? 1,
            daysOfWeek: event.recurrence.daysOfWeek ?? [],
            until: event.recurrence.until ? new Date(event.recurrence.until).toISOString() : null,
            count: event.recurrence.count ?? null,
          }
        : undefined,
      viewerStatus,
      myRequestId,
    }
  },

  requestJoinSharedEvent: async (
    userId: string,
    shareToken: string,
    rawMessage = '',
  ): Promise<{ requestId: string }> => {
    const cleanToken = shareToken.trim()
    const event = await EventModel.findOne({
      shareToken: cleanToken,
      isShareEnabled: true,
      entryType: 'event',
    })
    if (!event) {
      throw new AppError(404, 'SHARED_EVENT_NOT_FOUND', 'Sự kiện không còn tồn tại hoặc liên kết đã hết hiệu lực')
    }
    if (String(event.userId) === userId) {
      throw new AppError(400, 'CANNOT_JOIN_OWN_EVENT', 'Bạn là người tạo sự kiện này')
    }

    const viewer = await UserModel.findById(userId).select('email fullName').lean()
    const viewerEmail = viewer?.email?.trim().toLowerCase()
    if (!viewerEmail) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản người dùng')
    }

    const existingGuest = (event.guests || []).find(
      (g) => g.email.trim().toLowerCase() === viewerEmail,
    )
    if (existingGuest?.status === 'accepted') {
      throw new AppError(409, 'ALREADY_PARTICIPANT', 'Bạn đã tham gia sự kiện này')
    }
    if (existingGuest?.status === 'pending') {
      throw new AppError(409, 'INVITATION_PENDING', 'Bạn đã có lời mời tham gia sự kiện này')
    }

    const existingPendingReq = (event.joinRequests || []).find(
      (r) => String(r.userId) === userId && r.status === 'pending',
    )
    if (existingPendingReq) {
      throw new AppError(409, 'JOIN_REQUEST_EXISTS', 'Yêu cầu của bạn đang chờ duyệt')
    }

    const cleanMessage = rawMessage.trim().slice(0, 300)
    const requesterName = viewer?.fullName || viewerEmail
    event.joinRequests.push({
      userId: new Types.ObjectId(userId),
      email: viewerEmail,
      fullName: requesterName,
      message: cleanMessage,
      status: 'pending',
      createdAt: new Date(),
      respondedAt: null,
    })
    await event.save()

    const createdReq = event.joinRequests[event.joinRequests.length - 1]
    const requestId = createdReq ? String(createdReq._id) : ''

    try {
      await notificationService.createNotification({
        userId: String(event.userId),
        type: 'event_join_request',
        title: `Yêu cầu tham gia sự kiện: ${event.title}`,
        message: `${requesterName} xin tham gia sự kiện "${event.title}"${cleanMessage ? `: "${cleanMessage}"` : '.'}`,
        eventId: String(event._id),
        link: '/calendar',
        metadata: {
          requestId,
          requesterEmail: viewerEmail,
          requesterName,
          status: 'pending',
        },
      })
    } catch (err) {
      console.warn('[CalendarService] Không thể gửi thông báo yêu cầu tham gia:', err)
    }

    return { requestId }
  },

  cancelJoinRequest: async (userId: string, shareToken: string): Promise<void> => {
    const cleanToken = shareToken.trim()
    const event = await EventModel.findOne({
      shareToken: cleanToken,
      isShareEnabled: true,
      entryType: 'event',
    })
    if (!event) {
      throw new AppError(404, 'SHARED_EVENT_NOT_FOUND', 'Sự kiện không còn tồn tại hoặc liên kết đã hết hiệu lực')
    }

    await EventModel.updateOne(
      { _id: event._id },
      { $pull: { joinRequests: { userId: new Types.ObjectId(userId), status: 'pending' } } },
    )
  },

  respondJoinRequest: async (
    userId: string,
    eventId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ): Promise<CalendarEventResponse> => {
    if (!Types.ObjectId.isValid(eventId) || !Types.ObjectId.isValid(requestId)) {
      throw new AppError(404, 'JOIN_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu tham gia')
    }

    const event = await EventModel.findById(eventId)
    if (!event) {
      throw new AppError(404, 'EVENT_NOT_FOUND', 'Không tìm thấy sự kiện yêu cầu')
    }
    if (String(event.userId) !== userId) {
      throw new AppError(403, 'FORBIDDEN', 'Chỉ người tạo sự kiện mới có quyền duyệt yêu cầu')
    }

    const targetReq = event.joinRequests.find((r) => String(r._id) === requestId)
    if (!targetReq) {
      throw new AppError(404, 'JOIN_REQUEST_NOT_FOUND', 'Không tìm thấy yêu cầu tham gia')
    }
    if (targetReq.status !== 'pending') {
      throw new AppError(400, 'JOIN_REQUEST_ALREADY_HANDLED', 'Yêu cầu này đã được xử lý trước đó')
    }

    targetReq.status = decision
    targetReq.respondedAt = new Date()

    if (decision === 'approved') {
      const cleanEmail = targetReq.email.trim().toLowerCase()
      const existingGuest = event.guests.find((g) => g.email.trim().toLowerCase() === cleanEmail)
      if (existingGuest) {
        existingGuest.status = 'accepted'
      } else {
        event.guests.push({
          email: cleanEmail,
          role: 'viewer',
          canModify: false,
          canInviteOthers: true,
          canSeeGuestList: true,
          status: 'accepted',
        })
      }
      event.markModified('guests')
    }

    event.markModified('joinRequests')
    await event.save()

    try {
      await NotificationModel.updateMany(
        { eventId: event._id, type: 'event_join_request', 'metadata.requestId': requestId },
        { $set: { isRead: true, 'metadata.status': decision } },
      )
      await notificationService.createNotification({
        userId: String(targetReq.userId),
        type: 'event_join_response',
        title: decision === 'approved'
          ? `Đã được duyệt tham gia: ${event.title}`
          : `Yêu cầu tham gia bị từ chối: ${event.title}`,
        message: decision === 'approved'
          ? `Người tạo đã đồng ý yêu cầu tham gia sự kiện "${event.title}" của bạn.`
          : `Người tạo đã từ chối yêu cầu tham gia sự kiện "${event.title}" của bạn.`,
        eventId: String(event._id),
        link: '/calendar',
        metadata: {
          requestId,
          status: decision,
        },
      })
    } catch (err) {
      console.warn('[CalendarService] Không thể gửi thông báo kết quả duyệt:', err)
    }

    const populated = await calendarRepository.findEventById(userId, eventId)
    return mapEventResponse((populated ?? event) as unknown as RawEventDoc)
  },

  regeneratePublicToken: async (
    userId: string,
    categoryId: string,
  ): Promise<{ publicToken: string }> => {
    const user = await UserModel.findById(userId).select('email').lean()
    const existing = await calendarRepository.findCategoryDocById(categoryId)
    if (!existing) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    const role = getCategoryRole(existing as unknown as RawCategoryDoc, userId, user?.email)
    if (!role) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
    if (role !== 'owner' && role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Bạn không có quyền đổi liên kết công khai của lịch này')
    }

    const publicToken = randomBytes(16).toString('base64url')
    await CalendarCategoryModel.updateOne(
      { _id: categoryId },
      { $set: { publicToken, 'settings.privacy': 'public' } },
    )
    return { publicToken }
  },

  getPublicCalendarByToken: async (publicToken: string) => {
    const cleanToken = publicToken.trim()
    if (!cleanToken) {
      throw new AppError(404, 'PUBLIC_CALENDAR_NOT_FOUND', 'Lịch công khai không tồn tại hoặc đã chuyển sang chế độ riêng tư')
    }
    const category = await calendarRepository.findPublicCategoryByToken(cleanToken)
    if (!category) {
      throw new AppError(404, 'PUBLIC_CALENDAR_NOT_FOUND', 'Lịch công khai không tồn tại hoặc đã chuyển sang chế độ riêng tư')
    }

    const ownerPop =
      category.userId && typeof category.userId === 'object' && 'fullName' in category.userId
        ? (category.userId as { fullName?: string })
        : null
    const ownerName = ownerPop?.fullName || 'Người dùng EduTrack'

    const rawEvents = await calendarRepository.findEventsByCategoryId(String(category._id))
    const publicEvents: Array<{
      id: string
      title: string
      description: string
      startDate: string
      endDate: string
      isAllDay: boolean
      location: string
      onlineMeetingUrl: string
      color: string
      timeZone?: string
      recurrence?: RecurrenceConfig
      exceptionDates: string[]
      isMaskedBusy: boolean
    }> = []

    for (const raw of rawEvents) {
      const mapped = mapEventResponse(raw as unknown as RawEventDoc)
      if (mapped.entryType !== 'event') continue
      if (mapped.visibility === 'private') continue
      publicEvents.push({
          id: mapped.id,
          title: mapped.title,
          description: mapped.description,
          startDate: mapped.startDate,
          endDate: mapped.endDate,
          isAllDay: mapped.isAllDay,
          location: mapped.location,
          onlineMeetingUrl: mapped.onlineMeetingUrl,
          color: mapped.color || category.color || '#2563EB',
          timeZone: mapped.timeZone,
          recurrence: mapped.recurrence,
        exceptionDates: mapped.exceptionDates ?? [],
        isMaskedBusy: false,
      })
    }

    return {
      category: {
        id: String(category._id),
        name: category.name,
        color: category.color,
        description: category.description ?? '',
        timeZone: category.settings?.timeZone ?? 'Asia/Ho_Chi_Minh',
        ownerName,
      },
      events: publicEvents,
    }
  },

  exportPublicCalendarIcs: async (publicToken: string): Promise<{ icsContent: string; filename: string }> => {
    const { category, events } = await calendarService.getPublicCalendarByToken(publicToken)
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
    const formatIcsDate = (dateStr: string, isAllDay: boolean) => {
      const d = new Date(dateStr)
      if (isAllDay) {
        return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
      }
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    }
    const escapeIcs = (str: string) =>
      str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EduTrack//Calendar Module//VI',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcs(category.name)}`,
    ]
    if (category.description) {
      lines.push(`X-WR-CALDESC:${escapeIcs(category.description)}`)
    }
    if (category.timeZone) {
      lines.push(`X-WR-TIMEZONE:${category.timeZone}`)
    }
    for (const event of events) {
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:edutrack-${event.id}@edutrack.app`)
      lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString(), false)}`)
      if (event.isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.startDate, true)}`)
        lines.push(`DTEND;VALUE=DATE:${formatIcsDate(event.endDate, true)}`)
      } else {
        lines.push(`DTSTART:${formatIcsDate(event.startDate, false)}`)
        lines.push(`DTEND:${formatIcsDate(event.endDate, false)}`)
      }
      lines.push(`SUMMARY:${escapeIcs(event.title)}`)
      if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`)
      if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`)
      lines.push('END:VEVENT')
    }
    lines.push('END:VCALENDAR')
    const cleanFilename = category.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'calendar'
    return { icsContent: lines.join('\r\n'), filename: `${cleanFilename}.ics` }
  },

  subscribePublicCalendar: async (userId: string, publicToken: string): Promise<void> => {
    const existing = await calendarRepository.findPublicCategoryByToken(publicToken.trim())
    if (!existing) {
      throw new AppError(404, 'PUBLIC_CALENDAR_NOT_FOUND', 'Lịch công khai không tồn tại hoặc đã chuyển sang chế độ riêng tư')
    }
    const ownerId =
      existing.userId && typeof existing.userId === 'object' && '_id' in existing.userId
        ? String((existing.userId as { _id: unknown })._id)
        : String(existing.userId)
    if (ownerId === userId) {
      throw new AppError(400, 'CANNOT_SUBSCRIBE_OWN_CALENDAR', 'Bạn là chủ sở hữu lịch này')
    }
    await calendarRepository.subscribePublicCategory(publicToken.trim(), userId)
  },

  unsubscribePublicCalendar: async (userId: string, categoryId: string): Promise<void> => {
    const updated = await calendarRepository.unsubscribeCategory(categoryId, userId)
    if (!updated) {
      throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Không tìm thấy lịch yêu cầu')
    }
  },
}
