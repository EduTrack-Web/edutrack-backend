import type { RequestHandler } from 'express'

import { AppError } from '@/shared/errors/app-error.js'
import { clearAuthCookies } from '@/modules/auth/controllers/auth.controller.js'
import { accountService } from '@/modules/account/services/account.service.js'
import type { DeleteAccountDto, Disable2faDto } from '@/modules/account/types/account.types.js'
import {
  validateChangePassword,
  validateProfileSetup,
  validateUpdateProfile,
} from '@/modules/account/validations/account.validation.js'

export const getProfile: RequestHandler = async (_req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const profile = await accountService.getProfile(auth.userId)

  res.status(200).json({
    success: true,
    data: { user: profile },
  })
}

export const updateProfile: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const sanitizedInput = validateUpdateProfile(req.body)
  const updatedUser = await accountService.updateProfile(auth.userId, sanitizedInput)

  res.status(200).json({
    success: true,
    data: { user: updatedUser },
    message: 'Cập nhật thông tin cá nhân thành công.',
  })
}

export const checkUsername: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const usernameQuery = req.query.username
  if (typeof usernameQuery !== 'string' || !usernameQuery.trim()) {
    throw new AppError(400, 'INVALID_USERNAME', 'Vui lòng cung cấp tên đăng nhập cần kiểm tra.')
  }

  const result = await accountService.checkUsernameAvailability(auth.userId, usernameQuery)

  res.status(200).json({
    success: true,
    data: result,
  })
}

export const setupProfile: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const sanitizedInput = validateProfileSetup(req.body)
  const updatedUser = await accountService.setupProfile(auth.userId, sanitizedInput)

  res.status(200).json({
    success: true,
    data: { user: updatedUser },
    message: 'Hồ sơ đã được hoàn thiện thành công!',
  })
}

export const uploadAvatar: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  if (!req.file) {
    throw new AppError(400, 'FILE_REQUIRED', 'Vui lòng chọn file ảnh để tải lên.')
  }

  const result = await accountService.uploadAvatar(auth.userId, req.file)

  res.status(200).json({
    success: true,
    data: result,
    message: 'Tải ảnh đại diện thành công.',
  })
}

export const changePassword: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const currentProfile = await accountService.getProfile(auth.userId)
  const validatedInput = validateChangePassword(req.body, Boolean(currentProfile.hasPassword))

  const refreshToken = typeof req.cookies?.edutrack_refresh === 'string' ? req.cookies.edutrack_refresh : undefined
  const result = await accountService.changePassword(auth.userId, validatedInput, refreshToken)

  res.status(200).json({
    success: true,
    message: result.message,
  })
}

export const getSessions: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const refreshToken = typeof req.cookies?.edutrack_refresh === 'string' ? req.cookies.edutrack_refresh : undefined
  const sessions = await accountService.getActiveSessions(auth.userId, refreshToken)

  res.status(200).json({
    success: true,
    data: { sessions },
  })
}

export const revokeOtherSessions: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const refreshToken = typeof req.cookies?.edutrack_refresh === 'string' ? req.cookies.edutrack_refresh : undefined
  const result = await accountService.revokeOtherSessions(auth.userId, refreshToken)

  res.status(200).json({
    success: true,
    message: result.message,
  })
}

export const send2faOtp: RequestHandler = async (_req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const result = await accountService.send2faOtp(auth.userId)

  res.status(200).json({
    success: true,
    data: result,
    message: result.message,
  })
}

export const enable2fa: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const body = req.body as { otpId?: string; code?: string; otp?: string }
  const otpId = body?.otpId?.trim()
  const rawCode = (body?.code || body?.otp)?.trim()

  if (!otpId || !rawCode || rawCode.length !== 6) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Vui lòng nhập mã OTP đầy đủ 6 chữ số.', {
      code: 'Vui lòng nhập mã OTP gồm 6 chữ số.',
    })
  }

  const result = await accountService.enable2fa(auth.userId, otpId, rawCode)

  res.status(200).json({
    success: true,
    message: result.message,
  })
}

export const disable2fa: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const body = req.body as Disable2faDto & { otp?: string }
  const input: Disable2faDto = {
    password: body?.password,
    otpId: body?.otpId?.trim(),
    code: (body?.code || body?.otp)?.trim(),
  }

  const result = await accountService.disable2fa(auth.userId, input)

  res.status(200).json({
    success: true,
    message: result.message,
  })
}

export const unlinkGoogle: RequestHandler = async (_req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const result = await accountService.unlinkGoogle(auth.userId)

  res.status(200).json({
    success: true,
    message: result.message,
  })
}

export const sendDeleteAccountOtp: RequestHandler = async (_req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const result = await accountService.sendDeleteAccountOtp(auth.userId)

  res.status(200).json({
    success: true,
    data: result,
    message: result.message,
  })
}

export const deleteAccount: RequestHandler = async (req, res) => {
  const auth = res.locals.auth as { userId: string } | undefined
  if (!auth?.userId) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập để tiếp tục.')
  }

  const body = req.body as DeleteAccountDto & { otp?: string }
  const input: DeleteAccountDto = {
    password: body?.password,
    otpId: body?.otpId?.trim(),
    code: (body?.code || body?.otp)?.trim(),
  }

  const result = await accountService.deleteAccount(auth.userId, input)
  clearAuthCookies(res)

  res.status(200).json({
    success: true,
    message: result.message,
  })
}
