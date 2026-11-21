import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'

import { authenticate } from '@/shared/middleware/authenticate.js'
import { issueCsrfToken, requireCsrf } from '@/shared/middleware/csrf.js'
import { forgotPassword, handleGoogleCallback, login, logout, me, refresh, register, resendOtp, resetPassword, startGoogleLogin, verifyRegistration, verifyTwoFactor } from '@/modules/auth/controllers/auth.controller.js'

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })
const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false })

export const authRouter = Router()

authRouter.get('/csrf-token', issueCsrfToken)
authRouter.get('/google/authorizations', startGoogleLogin)
authRouter.get('/google/callback', handleGoogleCallback)
authRouter.post('/registrations', authLimiter, requireCsrf, register)
authRouter.post('/registration-verifications', authLimiter, requireCsrf, verifyRegistration)
authRouter.post('/sessions', loginLimiter, requireCsrf, login)
authRouter.get('/sessions/current', authenticate, me)
authRouter.patch('/sessions/current', refreshLimiter, requireCsrf, refresh)
authRouter.delete('/sessions/current', authLimiter, requireCsrf, logout)
authRouter.post('/two-factor-verifications', loginLimiter, requireCsrf, verifyTwoFactor)
authRouter.post('/password-reset-requests', authLimiter, requireCsrf, forgotPassword)
authRouter.post('/otp-resend-requests', authLimiter, requireCsrf, resendOtp)
authRouter.post('/password-resets', authLimiter, requireCsrf, resetPassword)
