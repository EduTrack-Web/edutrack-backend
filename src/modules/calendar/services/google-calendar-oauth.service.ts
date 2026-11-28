import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/config/env.js'
import { AppError } from '@/shared/errors/app-error.js'
import { googleCalendarRepository } from '@/modules/calendar/repositories/google-calendar.repository.js'
import {
  httpGoogleCalendarAdapter,
  resolveGoogleCalendarClientCredentials,
} from '@/modules/calendar/services/google-calendar.adapter.js'
import { encryptToken } from '@/modules/calendar/services/token-crypto.js'

const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const GOOGLE_CALENDAR_SCOPE =
  'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const OAUTH_REQUEST_TIMEOUT_MS = 12_000

export interface GoogleCalendarOAuthConfig {
  clientId: string
  clientSecret: string
  callbackUrl: string
}

interface CalendarOAuthStatePayload {
  purpose: 'calendar_sync'
  mode: 'add' | 'reconnect'
  integrationId?: string
  nonce: string
  userId: string
  iat: number
}

const resolveStateSigningKey = (): string => {
  const secret = env.jwtAccessSecret || env.googleCalendarClientSecret || env.googleClientSecret
  if (!secret) {
    if (env.nodeEnv === 'production') {
      throw new AppError(500, 'SERVER_MISCONFIGURED', 'Thiếu khóa ký phiên OAuth trên máy chủ.')
    }
    return 'edutrack-dev-gcal-oauth-state-key'
  }
  return secret
}

const signPayload = (encodedPayload: string): string =>
  createHmac('sha256', resolveStateSigningKey()).update(encodedPayload).digest('base64url')

export const encodeCalendarOAuthState = (payload: CalendarOAuthStatePayload): string => {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = signPayload(encoded)
  return `${encoded}.${signature}`
}

export const decodeCalendarOAuthState = (rawState: string): CalendarOAuthStatePayload | null => {
  if (!rawState) return null
  const parts = rawState.split('.')
  if (parts.length !== 2) return null
  const [encoded, signature] = parts
  if (!encoded || !signature) return null

  const expectedSignature = signPayload(encoded)
  if (signature.length !== expectedSignature.length) return null
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (
      record.purpose !== 'calendar_sync' ||
      (record.mode !== 'add' && record.mode !== 'reconnect') ||
      typeof record.nonce !== 'string' ||
      !record.nonce ||
      typeof record.userId !== 'string' ||
      !record.userId ||
      typeof record.iat !== 'number'
    ) {
      return null
    }
    if (Date.now() - record.iat > OAUTH_STATE_TTL_MS) {
      return null
    }
    return {
      purpose: 'calendar_sync',
      mode: record.mode,
      ...(typeof record.integrationId === 'string' && record.integrationId
        ? { integrationId: record.integrationId }
        : {}),
      nonce: record.nonce,
      userId: record.userId,
      iat: record.iat,
    }
  } catch {
    return null
  }
}

export const resolveGoogleCalendarCallbackUrl = (): string | undefined =>
  env.googleCalendarCallbackUrl?.trim() || undefined

export const resolveGoogleCalendarOAuthConfig = (): GoogleCalendarOAuthConfig | null => {
  const creds = resolveGoogleCalendarClientCredentials()
  const callbackUrl = resolveGoogleCalendarCallbackUrl()?.trim()
  if (!creds || !callbackUrl) return null
  return { ...creds, callbackUrl }
}

const requireGoogleCalendarOAuthConfig = (): GoogleCalendarOAuthConfig => {
  const config = resolveGoogleCalendarOAuthConfig()
  if (!config) {
    throw new AppError(
      503,
      'GOOGLE_OAUTH_NOT_CONFIGURED',
      'Đồng bộ Google Lịch chưa được cấu hình OAuth trên máy chủ.',
    )
  }
  return config
}

const readJsonSafely = async (response: globalThis.Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const extractOAuthError = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return ''
  return typeof body.error === 'string' ? body.error : ''
}

export const googleCalendarOAuthService = {
  createAuthorizationSession: (params: {
    userId: string
    mode?: 'add' | 'reconnect'
    integrationId?: string
  }) => {
    const config = requireGoogleCalendarOAuthConfig()
    const nonce = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(64).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const mode = params.mode === 'reconnect' && params.integrationId ? 'reconnect' : 'add'

    const state = encodeCalendarOAuthState({
      purpose: 'calendar_sync',
      mode,
      ...(mode === 'reconnect' && params.integrationId
        ? { integrationId: params.integrationId }
        : {}),
      nonce,
      userId: params.userId,
      iat: Date.now(),
    })

    const parameters = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      scope: GOOGLE_CALENDAR_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'consent select_account',
      access_type: 'offline',
      include_granted_scopes: 'true',
    })

    return {
      authorizationUrl: `${GOOGLE_OAUTH_AUTH_URL}?${parameters.toString()}`,
      nonce,
      codeVerifier,
    }
  },

  completeOAuthCallback: async (params: {
    errorParam?: string
    rawState: string
    code?: string
    storedNonce?: unknown
    codeVerifier?: unknown
  }): Promise<{
    integrationId: string
    isNewConnection: boolean
  }> => {
    const config = requireGoogleCalendarOAuthConfig()

    if (params.errorParam) {
      throw new AppError(
        401,
        'GOOGLE_CALENDAR_PERMISSION_DENIED',
        'Không thể đồng bộ do chưa cấp quyền.',
      )
    }

    const parsedState = decodeCalendarOAuthState(params.rawState)
    const validNonce =
      typeof params.storedNonce === 'string' &&
      Boolean(parsedState?.nonce) &&
      parsedState!.nonce.length === params.storedNonce.length &&
      timingSafeEqual(Buffer.from(parsedState!.nonce), Buffer.from(params.storedNonce))

    if (!validNonce || typeof params.codeVerifier !== 'string' || !parsedState) {
      throw new AppError(
        400,
        'GOOGLE_STATE_INVALID',
        'Phiên liên kết Google Lịch không hợp lệ hoặc đã hết hạn.',
      )
    }

    if (!params.code) {
      throw new AppError(400, 'GOOGLE_CODE_MISSING', 'Google không trả về mã xác thực.')
    }

    const nonceConsumed = await googleCalendarRepository.consumeOAuthNonce(
      parsedState.nonce,
      parsedState.userId,
    )
    if (!nonceConsumed) {
      throw new AppError(
        400,
        'GOOGLE_STATE_REPLAYED',
        'Phiên xác thực Google Lịch đã được sử dụng trước đó.',
      )
    }

    const isActiveUser = await googleCalendarRepository.isActiveUser(parsedState.userId)
    if (!isActiveUser) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản người dùng để đồng bộ.')
    }

    let tokenResponse: globalThis.Response
    try {
      tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: params.code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.callbackUrl,
          grant_type: 'authorization_code',
          code_verifier: params.codeVerifier,
        }),
        signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new AppError(502, 'GOOGLE_CALENDAR_CONNECT_FAILED', 'Không thể kết nối Google, vui lòng thử lại.')
    }

    const tokenBody = await readJsonSafely(tokenResponse)
    if (!tokenResponse.ok) {
      const providerError = extractOAuthError(tokenBody)
      if (providerError === 'invalid_client') {
        throw new AppError(503, 'GOOGLE_OAUTH_NOT_CONFIGURED', 'Cấu hình Google Calendar OAuth không hợp lệ.')
      }
      throw new AppError(401, 'GOOGLE_CALENDAR_CONNECT_FAILED', 'Không thể kết nối Google, vui lòng thử lại.')
    }

    if (
      typeof tokenBody !== 'object' ||
      tokenBody === null ||
      !('access_token' in tokenBody) ||
      typeof tokenBody.access_token !== 'string'
    ) {
      throw new AppError(401, 'GOOGLE_CALENDAR_CONNECT_FAILED', 'Phản hồi token Google không hợp lệ.')
    }

    let profileResponse: globalThis.Response
    try {
      profileResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new AppError(502, 'GOOGLE_CALENDAR_CONNECT_FAILED', 'Không thể kết nối Google, vui lòng thử lại.')
    }

    const profileBody = await readJsonSafely(profileResponse)
    if (!profileResponse.ok || typeof profileBody !== 'object' || profileBody === null) {
      throw new AppError(401, 'GOOGLE_CALENDAR_CONNECT_FAILED', 'Không thể đọc thông tin tài khoản Google.')
    }

    const profile = profileBody as Record<string, unknown>
    if (
      typeof profile.sub !== 'string' ||
      typeof profile.email !== 'string' ||
      profile.email_verified !== true
    ) {
      throw new AppError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Email Google chưa được xác minh.')
    }

    const tokenRecord = tokenBody as Record<string, unknown>
    const expiresIn =
      typeof tokenRecord.expires_in === 'number' && tokenRecord.expires_in > 0
        ? tokenRecord.expires_in
        : 3600
    const refreshToken =
      typeof tokenRecord.refresh_token === 'string' && tokenRecord.refresh_token
        ? tokenRecord.refresh_token
        : undefined

    const displayName = typeof profile.name === 'string' ? profile.name.trim() : ''
    const avatarUrl = typeof profile.picture === 'string' ? profile.picture.trim() : ''

    if (parsedState.mode === 'reconnect' && parsedState.integrationId) {
      const targetIntegration = await googleCalendarRepository.findIntegrationById(
        parsedState.userId,
        parsedState.integrationId,
        true,
      )
      if (!targetIntegration) {
        throw new AppError(404, 'GOOGLE_INTEGRATION_NOT_FOUND', 'Không tìm thấy liên kết Google cần kết nối lại.')
      }
      if (targetIntegration.googleSub !== profile.sub) {
        throw new AppError(
          409,
          'GOOGLE_ACCOUNT_MISMATCH',
          'Vui lòng chọn đúng tài khoản Google đã liên kết trước đó để kết nối lại.',
        )
      }
      if (!refreshToken && !targetIntegration.encryptedRefreshToken) {
        throw new AppError(
          400,
          'GOOGLE_REFRESH_TOKEN_MISSING',
          'Google không cấp quyền đồng bộ nền. Vui lòng liên kết và cấp lại quyền.',
        )
      }

      await googleCalendarRepository.updateIntegrationById(parsedState.userId, parsedState.integrationId, {
        googleEmail: profile.email.trim().toLowerCase(),
        displayName,
        avatarUrl,
        encryptedAccessToken: encryptToken(tokenBody.access_token),
        ...(refreshToken ? { encryptedRefreshToken: encryptToken(refreshToken) } : {}),
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        status: 'connected',
        lastError: '',
      })

      try {
        const calendars = await httpGoogleCalendarAdapter.listCalendars(tokenBody.access_token)
        await googleCalendarRepository.upsertCalendarsFromGoogle(
          parsedState.userId,
          parsedState.integrationId,
          calendars,
        )
      } catch {
      }

      return { integrationId: parsedState.integrationId, isNewConnection: false }
    }

    const existingBySub = await googleCalendarRepository.findIntegrationBySub(
      parsedState.userId,
      profile.sub,
      true,
    )
    if (!refreshToken && !existingBySub?.encryptedRefreshToken) {
      throw new AppError(
        400,
        'GOOGLE_REFRESH_TOKEN_MISSING',
        'Google không cấp quyền đồng bộ nền. Vui lòng liên kết và cấp lại quyền.',
      )
    }

    const totalExisting = await googleCalendarRepository.countIntegrationsByUserId(parsedState.userId)
    const isFirstAccount = totalExisting === 0

    const savedIntegration = await googleCalendarRepository.createOrUpdateIntegrationBySub(
      parsedState.userId,
      profile.sub,
      {
        googleEmail: profile.email.trim().toLowerCase(),
        displayName,
        avatarUrl,
        encryptedAccessToken: encryptToken(tokenBody.access_token),
        ...(refreshToken ? { encryptedRefreshToken: encryptToken(refreshToken) } : {}),
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        status: 'connected',
        lastError: '',
      },
      {
        isPrimarySyncAccount: isFirstAccount,
        syncToGoogleEnabled: isFirstAccount,
        syncFromGoogleEnabled: true,
      },
    )

    const integrationId = String(savedIntegration._id)
    const calendars = await httpGoogleCalendarAdapter.listCalendars(tokenBody.access_token)
    await googleCalendarRepository.upsertCalendarsFromGoogle(parsedState.userId, integrationId, calendars)

    return {
      integrationId,
      isNewConnection: !existingBySub,
    }
  },
}
