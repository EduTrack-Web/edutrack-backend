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

export const usersRouter = Router()

usersRouter.use(authenticate)
usersRouter.get('/me', getProfile)
usersRouter.patch('/me', requireCsrf, updateProfile)
usersRouter.delete('/me', requireCsrf, deleteAccount)
usersRouter.put('/me/avatar', requireCsrf, upload.single('avatar'), uploadAvatar)
usersRouter.get('/username-availability', checkUsername)
usersRouter.patch('/me/profile-completion', requireCsrf, setupProfile)
usersRouter.put('/me/password', requireCsrf, changePassword)
usersRouter.get('/me/sessions', getSessions)
usersRouter.delete('/me/sessions', requireCsrf, revokeOtherSessions)
usersRouter.post('/me/two-factor-challenges', requireCsrf, send2faOtp)
usersRouter.put('/me/two-factor-authentication', requireCsrf, enable2fa)
usersRouter.delete('/me/two-factor-authentication', requireCsrf, disable2fa)
usersRouter.delete('/me/google-link', requireCsrf, unlinkGoogle)
usersRouter.post('/me/deletion-verifications', requireCsrf, sendDeleteAccountOtp)
