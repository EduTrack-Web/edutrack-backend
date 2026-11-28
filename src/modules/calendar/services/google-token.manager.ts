import { AppError } from '@/shared/errors/app-error.js'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import type { GoogleCalendarAdapter } from '@/modules/calendar/services/google-calendar.adapter.js'
import {
  isTokenRevokedError,
  TOKEN_REFRESH_BUFFER_MS,
} from '@/modules/calendar/services/google-sync-errors.js'
import { decryptToken, encryptToken } from '@/modules/calendar/services/token-crypto.js'

export class GoogleTokenManager {
  public constructor(private readonly adapter: GoogleCalendarAdapter) {}

  public async withValidToken<T>(
    userId: string,
    integrationId: string,
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.ensureValidAccessToken(userId, integrationId, false)
    try {
      return await operation(token)
    } catch (error: unknown) {
      if (!isTokenRevokedError(error)) {
        throw error
      }
      const refreshed = await this.ensureValidAccessToken(userId, integrationId, true)
      return operation(refreshed)
    }
  }

  public async ensureValidAccessToken(
    userId: string,
    integrationId: string,
    forceRefresh: boolean,
  ): Promise<string> {
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
    if (integration.status === 'reconnect_required') {
      throw new AppError(
        401,
        'GOOGLE_CALENDAR_REAUTH_REQUIRED',
        'Phiên liên kết Google Lịch đã hết hạn hoặc bị thu hồi. Vui lòng liên kết lại.',
      )
    }

    const accessToken = decryptToken(integration.encryptedAccessToken ?? '')
    const refreshToken = decryptToken(integration.encryptedRefreshToken ?? '')
    const expiresAtMs = integration.tokenExpiresAt ? integration.tokenExpiresAt.getTime() : 0
    const isExpired = !accessToken || Date.now() >= expiresAtMs - TOKEN_REFRESH_BUFFER_MS

    if (!forceRefresh && !isExpired) {
      return accessToken
    }

    if (!refreshToken) {
      await this.markReconnectRequired(
        userId,
        integrationId,
        'Phiên liên kết Google Lịch đã hết hạn. Vui lòng liên kết lại.',
      )
      throw new AppError(
        401,
        'GOOGLE_CALENDAR_REAUTH_REQUIRED',
        'Phiên liên kết Google Lịch đã hết hạn hoặc bị thu hồi. Vui lòng liên kết lại.',
      )
    }

    return this.refreshAndPersistAccessToken(userId, integrationId, refreshToken)
  }

  public async markReconnectRequired(
    userId: string,
    integrationId: string,
    message: string,
  ): Promise<void> {
    await googleCalendarRepository.cancelPendingJobsForIntegration(userId, integrationId)
    await googleCalendarRepository.updateIntegrationById(userId, integrationId, {
      status: 'reconnect_required',
      encryptedAccessToken: '',
      encryptedRefreshToken: '',
      tokenExpiresAt: null,
      lastError: message,
    })
  }

  public async fetchEventColorPaletteSafe(
    userId: string,
    integrationId: string,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (!this.adapter.getColors) return undefined
    try {
      return await this.withValidToken(userId, integrationId, (accessToken) =>
        this.adapter.getColors!(accessToken),
      )
    } catch {
      return undefined
    }
  }

  public async fetchCalendarEventLabelsSafe(
    userId: string,
    integrationId: string,
    googleCalendarId: string,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (!this.adapter.getCalendarEventLabels) return undefined
    try {
      return await this.withValidToken(userId, integrationId, (accessToken) =>
        this.adapter.getCalendarEventLabels!(accessToken, googleCalendarId),
      )
    } catch {
      return undefined
    }
  }

  public async refreshCalendarsMetadataSafe(userId: string, integrationId: string): Promise<void> {
    try {
      const items = await this.withValidToken(userId, integrationId, (accessToken) =>
        this.adapter.listCalendars(accessToken),
      )
      await googleCalendarRepository.upsertCalendarsFromGoogle(userId, integrationId, items)
    } catch {
      return
    }
  }

  private async refreshAndPersistAccessToken(
    userId: string,
    integrationId: string,
    refreshToken: string,
  ): Promise<string> {
    try {
      const refreshed = await this.adapter.refreshAccessToken(refreshToken)
      await googleCalendarRepository.updateIntegrationById(userId, integrationId, {
        encryptedAccessToken: encryptToken(refreshed.accessToken),
        ...(refreshed.refreshToken
          ? { encryptedRefreshToken: encryptToken(refreshed.refreshToken) }
          : {}),
        tokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        status: 'connected',
        lastError: '',
      })
      return refreshed.accessToken
    } catch (error: unknown) {
      if (isTokenRevokedError(error)) {
        await this.markReconnectRequired(
          userId,
          integrationId,
          'Quyền truy cập Google Lịch đã bị thu hồi hoặc hết hiệu lực. Vui lòng liên kết lại.',
        )
        throw new AppError(
          401,
          'GOOGLE_CALENDAR_REAUTH_REQUIRED',
          'Phiên liên kết Google Lịch đã hết hạn hoặc bị thu hồi. Vui lòng liên kết lại.',
        )
      }
      throw new AppError(
        502,
        'GOOGLE_CALENDAR_SYNC_FAILED',
        'Lỗi kết nối Google Lịch trong lúc làm mới phiên. Vui lòng thử lại.',
      )
    }
  }
}
