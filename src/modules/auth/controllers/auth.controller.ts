import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { Request, RequestHandler, Response } from 'express'

import { env } from '../../../config/env.js'
import { AppError } from '../../../shared/errors/app-error.js'
import { CSRF_COOKIE } from '../../../shared/middleware/csrf.js'
import { UserModel } from '../models/user.model.js'
import { authService } from '../services/auth.service.js'
import { accessMaxAge, refreshMaxAge, verifyAccessToken } from '../services/token.service.js'
import type { OtpPurpose } from '../types/auth.types.js'
import { requiredString, requiredStrings } from '../validations/auth.validation.js'

const ACCESS_COOKIE = 'edutrack_access'
const REFRESH_COOKIE = 'edutrack_refresh'
const GOOGLE_STATE_COOKIE = 'edutrack_google_state'
const GOOGLE_VERIFIER_COOKIE = 'edutrack_google_verifier'

interface OAuthStatePayload {
  nonce: string
  action: 'login' | `link:${string}`
}

const encodeOAuthState = (payload: OAuthStatePayload): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64url')

const decodeOAuthState = (raw: string): OAuthStatePayload | null => {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
    if (typeof parsed === 'object' && parsed !== null && 'nonce' in parsed && 'action' in parsed) {
      return parsed as OAuthStatePayload
    }
    return null
  } catch {
    return null
  }
}

const cookieBase = () => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: env.nodeEnv === 'production' ? 'none' as const : 'lax' as const,
})

const setAuthCookies = (response: Response, tokens: { accessToken: string; refreshToken: string }): void => {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, { ...cookieBase(), maxAge: accessMaxAge, path: '/' })
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieBase(), maxAge: refreshMaxAge, path: '/v1/api/auth' })
}

export const clearAuthCookies = (response: Response): void => {
  response.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' })
  response.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/v1/api/auth' })
  response.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: env.nodeEnv === 'production',
    sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/',
  })
}

const requestContext = (request: Request) => ({
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent') } : {}),
  ...(request.ip ? { ipAddress: request.ip } : {}),
})

export const register: RequestHandler = async (request, response) => {
  const { fullName, email, password, confirmPassword } = requiredStrings(request.body, {
    fullName: 'họ và tên', email: 'email', password: 'mật khẩu', confirmPassword: 'xác nhận mật khẩu',
  })
  const result = await authService.register({ fullName, email, password, confirmPassword })
  response.status(201).json({ success: true, data: result, message: 'Mã OTP đã được gửi đến email của bạn.' })
}

export const verifyRegistration: RequestHandler = async (request, response) => {
  const otpId = requiredString(request.body.otpId, 'otp', 'mã xác thực')
  const code = requiredString(request.body.code, 'otp', 'mã xác thực')
  const user = await authService.verifyRegistration(otpId, code)
  response.json({ success: true, data: { user }, message: 'Xác minh tài khoản thành công.' })
}

export const login: RequestHandler = async (request, response) => {
  const { identifier, password } = requiredStrings(request.body, {
    identifier: 'username hoặc email', password: 'mật khẩu',
  })
  const result = await authService.login(identifier, password, requestContext(request))
  if ('requiresVerification' in result) {
    response.status(202).json({ success: true, data: result, message: 'Vui lòng xác minh email để tiếp tục.' })
    return
  }
  if ('requiresTwoFactor' in result) {
    response.status(202).json({ success: true, data: result, message: 'Vui lòng nhập OTP xác thực đăng nhập.' })
    return
  }
  setAuthCookies(response, result.tokens)
  response.json({ success: true, data: { user: result.user }, message: 'Đăng nhập thành công.' })
}

export const verifyTwoFactor: RequestHandler = async (request, response) => {
  const otpId = requiredString(request.body.otpId, 'otp', 'mã xác thực')
  const code = requiredString(request.body.code, 'otp', 'mã xác thực')
  const result = await authService.verifyTwoFactor(otpId, code, requestContext(request))
  setAuthCookies(response, result.tokens)
  response.json({ success: true, data: { user: result.user }, message: 'Đăng nhập thành công.' })
}

export const forgotPassword: RequestHandler = async (request, response) => {
  const email = requiredString(request.body.email, 'email', 'email')
  const result = await authService.forgotPassword(email)
  response.json({ success: true, data: result, message: 'Nếu email hợp lệ, mã đặt lại mật khẩu đã được gửi.' })
}

export const resendOtp: RequestHandler = async (request, response) => {
  const otpId = requiredString(request.body.otpId, 'otp', 'mã xác thực')
  const purpose = requiredString(request.body.purpose, 'otp', 'mục đích xác thực')
  if (!['registration', 'password-reset', 'login-2fa', 'toggle-2fa', 'delete-account'].includes(purpose)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Mục đích OTP không hợp lệ.')
  }
  const result = await authService.resendOtp(otpId, purpose as OtpPurpose)
  response.json({ success: true, data: result, message: 'Mã OTP mới đã được gửi.' })
}

export const resetPassword: RequestHandler = async (request, response) => {
  const otpId = requiredString(request.body.otpId, 'otp', 'mã xác thực')
  const code = requiredString(request.body.code, 'otp', 'mã xác thực')
  const newPassword = requiredString(request.body.newPassword, 'newPassword', 'mật khẩu mới')
  const confirmPassword = requiredString(request.body.confirmPassword, 'confirmPassword', 'xác nhận mật khẩu')
  await authService.resetPassword(otpId, code, newPassword, confirmPassword)
  clearAuthCookies(response)
  response.json({ success: true, message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' })
}

export const refresh: RequestHandler = async (request, response) => {
  const token = request.cookies[REFRESH_COOKIE]
  if (typeof token !== 'string') throw new AppError(401, 'REFRESH_TOKEN_REQUIRED', 'Phiên đăng nhập đã hết hạn.')
  const result = await authService.refresh(token, requestContext(request))
  setAuthCookies(response, result.tokens)
  response.json({ success: true, data: { user: result.user } })
}

export const logout: RequestHandler = async (request, response) => {
  const token = request.cookies[REFRESH_COOKIE]
  await authService.logout(typeof token === 'string' ? token : undefined)
  clearAuthCookies(response)
  response.json({ success: true, message: 'Đăng xuất thành công.' })
}

export const me: RequestHandler = async (_request, response) => {
  const auth = response.locals.auth as { userId: string }
  const user = await UserModel.findById(auth.userId)
  if (!user || user.status !== 'active') throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'Tài khoản không khả dụng.')
  response.json({ success: true, data: { user: authService.toSafeUser(user) } })
}

const requireGoogleConfig = () => {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCallbackUrl) {
    throw new AppError(503, 'GOOGLE_OAUTH_NOT_CONFIGURED', 'Đăng nhập Google chưa được cấu hình.')
  }
  return {
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    callbackUrl: env.googleCallbackUrl,
  }
}

export const startGoogleLogin: RequestHandler = (request, response) => {
  const google = requireGoogleConfig()
  const nonce = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

  const isLink = request.query.action === 'link'
  let actionValue: OAuthStatePayload['action'] = 'login'
  if (isLink) {
    const accessToken = request.cookies[ACCESS_COOKIE]
    if (typeof accessToken !== 'string') {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để liên kết tài khoản Google.')
    }
    const auth = verifyAccessToken(accessToken)
    actionValue = `link:${auth.userId}`
  }

  const state = encodeOAuthState({ nonce, action: actionValue })

  response.cookie(GOOGLE_STATE_COOKIE, nonce, { ...cookieBase(), maxAge: 10 * 60 * 1000, path: '/v1/api/auth/google' })
  response.cookie(GOOGLE_VERIFIER_COOKIE, codeVerifier, { ...cookieBase(), maxAge: 10 * 60 * 1000, path: '/v1/api/auth/google' })

  const parameters = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: google.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`)
}

const processGoogleCallback = async (request: Request, response: Response): Promise<void> => {
  const google = requireGoogleConfig()
  if (typeof request.query.error === 'string') {
    throw new AppError(401, 'GOOGLE_ACCESS_DENIED', 'Bạn đã hủy hoặc từ chối đăng nhập bằng Google.')
  }
  const rawState = typeof request.query.state === 'string' ? request.query.state : ''
  const parsedState = decodeOAuthState(rawState)
  const storedNonce = request.cookies[GOOGLE_STATE_COOKIE]
  const codeVerifier = request.cookies[GOOGLE_VERIFIER_COOKIE]

  const validNonce = typeof storedNonce === 'string' && parsedState?.nonce
    && parsedState.nonce.length === storedNonce.length
    && timingSafeEqual(Buffer.from(parsedState.nonce), Buffer.from(storedNonce))

  response.clearCookie(GOOGLE_STATE_COOKIE, { ...cookieBase(), path: '/v1/api/auth/google' })
  response.clearCookie(GOOGLE_VERIFIER_COOKIE, { ...cookieBase(), path: '/v1/api/auth/google' })

  if (!validNonce || typeof codeVerifier !== 'string' || !parsedState) {
    throw new AppError(400, 'GOOGLE_STATE_INVALID', 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.')
  }

  const actionData = parsedState.action
  const code = typeof request.query.code === 'string' ? request.query.code : undefined
  if (!code) throw new AppError(400, 'GOOGLE_CODE_MISSING', 'Google không trả về mã xác thực.')

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: google.callbackUrl,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  })
  if (!tokenResponse.ok) throw new AppError(401, 'GOOGLE_AUTH_FAILED', 'Không thể xác thực với Google.')
  const tokenBody: unknown = await tokenResponse.json()
  if (typeof tokenBody !== 'object' || tokenBody === null || !('access_token' in tokenBody) || typeof tokenBody.access_token !== 'string') {
    throw new AppError(401, 'GOOGLE_AUTH_FAILED', 'Phản hồi Google không hợp lệ.')
  }
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  })
  const profile: unknown = await profileResponse.json()
  if (!profileResponse.ok || typeof profile !== 'object' || profile === null) throw new AppError(401, 'GOOGLE_PROFILE_FAILED', 'Không thể đọc hồ sơ Google.')
  const data = profile as Record<string, unknown>
  if (typeof data.sub !== 'string' || typeof data.email !== 'string' || data.email_verified !== true || typeof data.name !== 'string') {
    throw new AppError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Email Google chưa được xác minh.')
  }

  // 1. Luồng Liên kết tài khoản Google
  if (actionData.startsWith('link:')) {
    const linkUserId = actionData.split(':')[1]
    const existingLinkedUser = await UserModel.findOne({ googleId: data.sub })
    if (existingLinkedUser && String(existingLinkedUser._id) !== linkUserId) {
      throw new AppError(409, 'GOOGLE_ALREADY_LINKED', 'Tài khoản Google này đã được liên kết với một tài khoản EduTrack khác.')
    }

    const userToLink = await UserModel.findById(linkUserId)
    if (!userToLink || userToLink.status !== 'active') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản người dùng để liên kết.')
    }

    userToLink.googleId = data.sub
    if (!userToLink.avatarUrl && typeof data.picture === 'string') {
      userToLink.avatarUrl = data.picture
    }
    await userToLink.save()

    response.redirect(`${env.frontendUrl}/account?oauthSuccess=GOOGLE_LINKED`)
    return
  }

  // 2. Luồng Đăng nhập Google thông thường
  const result = await authService.loginWithGoogle({
    googleId: data.sub,
    email: data.email,
    fullName: data.name,
    ...(typeof data.picture === 'string' ? { avatarUrl: data.picture } : {}),
  }, requestContext(request))
  setAuthCookies(response, result.tokens)
  const targetPath = result.user.profileCompleted ? '/dashboard' : '/onboarding'
  response.redirect(`${env.frontendUrl}${targetPath}`)
}

export const handleGoogleCallback: RequestHandler = async (request, response) => {
  const rawState = typeof request.query.state === 'string' ? request.query.state : ''
  const parsedState = decodeOAuthState(rawState)
  const isLinkAction = Boolean(parsedState?.action?.startsWith('link:'))

  try {
    await processGoogleCallback(request, response)
  } catch (error: unknown) {
    const errorCode = error instanceof AppError ? error.code : 'GOOGLE_AUTH_FAILED'
    const parameters = new URLSearchParams({ oauthError: errorCode })
    const redirectUrl = isLinkAction ? `${env.frontendUrl}/account` : `${env.frontendUrl}/login`
    response.redirect(`${redirectUrl}?${parameters.toString()}`)
  }
}
