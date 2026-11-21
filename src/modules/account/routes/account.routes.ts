import { Router } from 'express'
import multer from 'multer'

import { AppError } from '@/shared/errors/app-error.js'
import { authenticate } from '@/shared/middleware/authenticate.js'
import { requireCsrf } from '@/shared/middleware/csrf.js'
import {
  changePassword,
  checkUsername,
  deleteAccount,
  disable2fa,
  enable2fa,
  getProfile,
  getSessions,
  revokeOtherSessions,
  send2faOtp,
  sendDeleteAccountOtp,
  setupProfile,
  unlinkGoogle,
  updateProfile,
  uploadAvatar,
} from '@/modules/account/controllers/account.controller.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB tối đa
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new AppError(422, 'INVALID_FILE_TYPE', 'Định dạng ảnh không được hỗ trợ. Vui lòng chọn JPG, PNG hoặc WebP.'))
    }
  },
})

export const accountRouter = Router()
export const usersRestRouter = Router()

// Tất cả endpoints của account đều yêu cầu đăng nhập
accountRouter.use(authenticate)

accountRouter.get('/profile', getProfile)
accountRouter.patch('/profile', requireCsrf, updateProfile)
accountRouter.post('/avatar', requireCsrf, upload.single('avatar'), uploadAvatar)

// Onboarding & Khảo sát hoàn thiện hồ sơ
accountRouter.get('/check-username', checkUsername)
accountRouter.post('/profile-setup', requireCsrf, setupProfile)

// Nhóm 1.2: Đổi mật khẩu & Quản lý phiên làm việc
accountRouter.post('/change-password', requireCsrf, changePassword)
accountRouter.get('/sessions', getSessions)
accountRouter.post('/sessions/revoke-others', requireCsrf, revokeOtherSessions)

// Bật / Tắt 2FA qua Email OTP
accountRouter.post('/2fa/send-otp', requireCsrf, send2faOtp)
accountRouter.post('/2fa/enable', requireCsrf, enable2fa)
accountRouter.post('/2fa/disable', requireCsrf, disable2fa)

// Hủy liên kết tài khoản Google
accountRouter.post('/google/unlink', requireCsrf, unlinkGoogle)

// Xóa tài khoản vĩnh viễn (Danger Zone)
accountRouter.post('/delete/send-otp', requireCsrf, sendDeleteAccountOtp)
accountRouter.delete('/', requireCsrf, deleteAccount)

usersRestRouter.use(authenticate)
usersRestRouter.get('/me', getProfile)
usersRestRouter.patch('/me', requireCsrf, updateProfile)
usersRestRouter.delete('/me', requireCsrf, deleteAccount)
usersRestRouter.put('/me/avatar', requireCsrf, upload.single('avatar'), uploadAvatar)
usersRestRouter.get('/username-availability', checkUsername)
usersRestRouter.patch('/me/profile-completion', requireCsrf, setupProfile)
usersRestRouter.put('/me/password', requireCsrf, changePassword)
usersRestRouter.get('/me/sessions', getSessions)
usersRestRouter.delete('/me/sessions', requireCsrf, revokeOtherSessions)
usersRestRouter.post('/me/two-factor-challenges', requireCsrf, send2faOtp)
usersRestRouter.put('/me/two-factor-authentication', requireCsrf, enable2fa)
usersRestRouter.delete('/me/two-factor-authentication', requireCsrf, disable2fa)
usersRestRouter.delete('/me/google-link', requireCsrf, unlinkGoogle)
usersRestRouter.post('/me/deletion-verifications', requireCsrf, sendDeleteAccountOtp)
