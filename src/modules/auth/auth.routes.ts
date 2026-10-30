import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'

import { authenticate } from '../../shared/middleware/authenticate.js'
import { issueCsrfToken, requireCsrf } from '../../shared/middleware/csrf.js'
import { forgotPassword, handleGoogleCallback, login, logout, me, refresh, register, resendOtp, resetPassword, startGoogleLogin, verifyRegistration, verifyTwoFactor } from './auth.controller.js'

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })

export const authRouter = Router()

authRouter.get('/csrf', issueCsrfToken)
authRouter.get('/google', startGoogleLogin)
authRouter.get('/google/callback', handleGoogleCallback)
authRouter.post('/register', authLimiter, requireCsrf, register)
authRouter.post('/verify-registration', authLimiter, requireCsrf, verifyRegistration)
authRouter.post('/login', loginLimiter, requireCsrf, login)
authRouter.post('/verify-two-factor', loginLimiter, requireCsrf, verifyTwoFactor)
authRouter.post('/forgot-password', authLimiter, requireCsrf, forgotPassword)
authRouter.post('/resend-otp', authLimiter, requireCsrf, resendOtp)
authRouter.post('/reset-password', authLimiter, requireCsrf, resetPassword)
authRouter.post('/refresh', authLimiter, requireCsrf, refresh)
authRouter.post('/logout', authLimiter, requireCsrf, logout)
authRouter.get('/me', authenticate, me)
