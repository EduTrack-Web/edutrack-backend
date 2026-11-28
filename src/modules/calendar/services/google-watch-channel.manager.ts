import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import type { GoogleCalendarAdapter } from '@/modules/calendar/services/google-calendar.adapter.js'
import {
  ONLINE_POLL_SYNC_INTERVAL_MS,
  PASSIVE_FALLBACK_SYNC_INTERVAL_MS,
} from '@/modules/calendar/services/google-sync-errors.js'
import type { GoogleTokenManager } from '@/modules/calendar/services/google-token.manager.js'

const WATCH_CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60
const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface WatchChannelRecord {
  channelId?: string
  resourceId?: string
  tokenHash?: string
  expiration?: Date | null
}

export interface IncomingGoogleWebhookHeaders {
  channelId: string
  resourceId: string
  resourceState: string
  channelToken: string
}

export type VerifiedWebhookOutcome =
  | { action: 'ack_only' }
  | {
      action: 'sync_calendar'
      userId: string
      integrationId: string
      calendarConnectionId: string
    }

export const resolveValidHttpsWebhookUrl = (rawUrl?: string): string | null => {
  const candidate = rawUrl?.trim()
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:') return null
    if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export const hashWebhookToken = (rawToken: string): string =>
  createHash('sha256').update(rawToken, 'utf8').digest('hex')

export const verifyWebhookTokenHash = (rawToken: string, expectedHash: string): boolean => {
  if (!rawToken || !expectedHash) return false
  const actualHash = hashWebhookToken(rawToken)
  if (actualHash.length !== expectedHash.length) return false
  return timingSafeEqual(Buffer.from(actualHash, 'utf8'), Buffer.from(expectedHash, 'utf8'))
}

export class GoogleWatchChannelManager {
  public constructor(
    private readonly adapter: GoogleCalendarAdapter,
    private readonly tokenManager: GoogleTokenManager,
    private readonly webhookUrlOverride?: string,
  ) {}

  public getWebhookUrl(): string | null {
    return resolveValidHttpsWebhookUrl(this.webhookUrlOverride ?? env.googleCalendarWebhookUrl)
  }

  public hasActiveWatchChannel(
    calendar: { watchChannel?: WatchChannelRecord | null },
    now = new Date(),
  ): boolean {
    const channel = calendar.watchChannel
    if (!channel?.channelId || !channel.expiration) return false
    return channel.expiration.getTime() > now.getTime()
  }

  public computeNextSyncAt(
    calendar: { watchChannel?: WatchChannelRecord | null },
    isUserOnline: boolean,
    now = new Date(),
  ): Date {
    const hasWebhook = this.hasActiveWatchChannel(calendar, now)
    const intervalMs =
      hasWebhook || !isUserOnline
        ? PASSIVE_FALLBACK_SYNC_INTERVAL_MS
        : ONLINE_POLL_SYNC_INTERVAL_MS
    return new Date(now.getTime() + intervalMs)
  }

  public async ensureWatchChannel(
    userId: string,
    integrationId: string,
    calendarConnectionId: string,
  ): Promise<boolean> {
    const webhookUrl = this.getWebhookUrl()
    if (!webhookUrl || !this.adapter.watchEvents) return false

    const [integration, calendar] = await Promise.all([
      googleCalendarRepository.findIntegrationById(userId, integrationId),
      googleCalendarRepository.findCalendarById(userId, calendarConnectionId),
    ])
    if (!this.isEligibleForWatch(integration, calendar)) return false

    const renewThreshold = Date.now() + WATCH_RENEWAL_WINDOW_MS
    const currentExpiration = calendar.watchChannel?.expiration?.getTime() ?? 0
    if (calendar.watchChannel?.channelId && currentExpiration > renewThreshold) {
      return true
    }

    await this.stopRemoteChannelBestEffort(userId, integrationId, calendar.watchChannel)
    return this.registerNewWatchChannel(
      userId,
      integrationId,
      calendarConnectionId,
      calendar.googleCalendarId,
      webhookUrl,
    )
  }

  public async stopWatchChannelForCalendar(
    userId: string,
    integrationId: string,
    calendar: { _id: unknown; watchChannel?: WatchChannelRecord | null },
  ): Promise<void> {
    await this.stopRemoteChannelBestEffort(userId, integrationId, calendar.watchChannel)
    await googleCalendarRepository.updateCalendarById(String(calendar._id), {
      watchChannel: { channelId: '', resourceId: '', tokenHash: '', expiration: null },
    })
  }

  public async stopAllWatchChannelsForIntegration(
    userId: string,
    integrationId: string,
    rawAccessToken?: string,
  ): Promise<void> {
    if (!this.adapter.stopWatchChannel) return
    const calendars = await googleCalendarRepository.findCalendarsByIntegrationId(
      userId,
      integrationId,
    )
    const activeChannels = calendars.filter(
      (cal) => Boolean(cal.watchChannel?.channelId && cal.watchChannel?.resourceId),
    )
    if (activeChannels.length === 0) return

    const accessToken =
      rawAccessToken ||
      (await this.tokenManager.ensureValidAccessToken(userId, integrationId, false).catch(() => ''))
    if (!accessToken) return

    await Promise.allSettled(
      activeChannels.map((cal) =>
        this.adapter.stopWatchChannel!({
          accessToken,
          channelId: cal.watchChannel?.channelId ?? '',
          resourceId: cal.watchChannel?.resourceId ?? '',
        }),
      ),
    )
  }

  public async renewDueWatchChannels(): Promise<void> {
    if (!this.getWebhookUrl() || !this.adapter.watchEvents) return
    const renewBefore = new Date(Date.now() + WATCH_RENEWAL_WINDOW_MS)
    const candidates =
      await googleCalendarRepository.findSelectedCalendarsNeedingWatchRenewal(renewBefore)

    for (const cal of candidates) {
      await this.ensureWatchChannel(
        String(cal.userId),
        String(cal.integrationId),
        String(cal._id),
      )
    }
  }

  public async verifyWebhookNotification(
    headers: IncomingGoogleWebhookHeaders,
  ): Promise<VerifiedWebhookOutcome> {
    const channelId = headers.channelId.trim()
    const resourceId = headers.resourceId.trim()
    const resourceState = headers.resourceState.trim().toLowerCase()
    if (!channelId || !resourceId) {
      throw new AppError(401, 'INVALID_WEBHOOK_HEADERS', 'Thiếu thông tin xác thực kênh Google.')
    }

    const calendar = await googleCalendarRepository.findCalendarByWatchChannelId(channelId)
    if (!calendar || !calendar.watchChannel) {
      throw new AppError(401, 'UNKNOWN_WEBHOOK_CHANNEL', 'Kênh thông báo không tồn tại hoặc đã hủy.')
    }

    const matchesResource = calendar.watchChannel.resourceId === resourceId
    const matchesToken = verifyWebhookTokenHash(
      headers.channelToken.trim(),
      calendar.watchChannel.tokenHash ?? '',
    )
    if (!matchesResource || !matchesToken) {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Chữ ký kênh thông báo Google không hợp lệ.')
    }

    if (resourceState === 'sync' || !calendar.isSelected) {
      return { action: 'ack_only' }
    }

    return {
      action: 'sync_calendar',
      userId: String(calendar.userId),
      integrationId: String(calendar.integrationId),
      calendarConnectionId: String(calendar._id),
    }
  }

  private isEligibleForWatch(
    integration: { status?: string; syncFromGoogleEnabled?: boolean } | null,
    calendar: { isSelected?: boolean } | null,
  ): calendar is NonNullable<typeof calendar> {
    return Boolean(
      integration &&
        integration.status === 'connected' &&
        integration.syncFromGoogleEnabled &&
        calendar &&
        calendar.isSelected,
    )
  }

  private async stopRemoteChannelBestEffort(
    userId: string,
    integrationId: string,
    channel?: WatchChannelRecord | null,
  ): Promise<void> {
    if (!this.adapter.stopWatchChannel || !channel?.channelId || !channel.resourceId) return
    try {
      await this.tokenManager.withValidToken(userId, integrationId, (accessToken) =>
        this.adapter.stopWatchChannel!({
          accessToken,
          channelId: channel.channelId!,
          resourceId: channel.resourceId!,
        }),
      )
    } catch {
      return
    }
  }

  private async registerNewWatchChannel(
    userId: string,
    integrationId: string,
    calendarConnectionId: string,
    googleCalendarId: string,
    webhookUrl: string,
  ): Promise<boolean> {
    const channelId = randomUUID()
    const webhookToken = randomBytes(32).toString('base64url')
    try {
      const registered = await this.tokenManager.withValidToken(
        userId,
        integrationId,
        (accessToken) =>
          this.adapter.watchEvents!({
            accessToken,
            calendarId: googleCalendarId,
            channelId,
            webhookToken,
            webhookUrl,
            ttlSeconds: WATCH_CHANNEL_TTL_SECONDS,
          }),
      )
      await googleCalendarRepository.updateCalendarById(calendarConnectionId, {
        watchChannel: {
          channelId: registered.channelId,
          resourceId: registered.resourceId,
          tokenHash: hashWebhookToken(webhookToken),
          expiration: registered.expiration,
        },
      })
      return true
    } catch {
      return false
    }
  }
}
