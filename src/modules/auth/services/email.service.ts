import { env } from '@/config/env.js'
import type { OtpPurpose } from '@/modules/auth/types/auth.types.js'
import { AppError } from '@/shared/errors/app-error.js'

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails'
const EMAIL_REQUEST_TIMEOUT_MS = 10_000

type EmailServiceConfig = Readonly<{
  apiKey?: string
  fromEmail?: string
  fromName: string
}>

type EmailRequest = typeof fetch

const subjectByPurpose: Readonly<Record<OtpPurpose, string>> = {
  registration: 'Mã xác thực đăng ký EduTrack',
  'password-reset': 'Mã đặt lại mật khẩu EduTrack',
  'login-2fa': 'Mã xác thực đăng nhập EduTrack',
  'toggle-2fa': 'Mã xác thực bảo mật EduTrack',
  'delete-account': 'Mã xác nhận xóa tài khoản EduTrack',
}

const buildSender = (fromName: string, fromEmail: string): string => {
  const safeName = fromName.replace(/[\r\n<>]/g, '').trim() || 'EduTrack'
  return `${safeName} <${fromEmail.trim()}>`
}

export const createEmailService = (
  config: EmailServiceConfig,
  request: EmailRequest = fetch,
) => ({
  async sendOtpEmail(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    if (!config.apiKey?.trim() || !config.fromEmail?.trim()) {
      throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Dịch vụ email chưa được cấu hình.')
    }

    const subject = subjectByPurpose[purpose]
    const message = `Mã OTP của bạn là ${code}. Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.`

    try {
      const response = await request(RESEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: buildSender(config.fromName, config.fromEmail),
          to: [email],
          subject,
          text: message,
          html: `<div style="font-family:Arial,sans-serif;color:#021024"><h2>${subject}</h2><p>Mã OTP của bạn:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px;color:#052659">${code}</p><p>Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.</p></div>`,
          tags: [{ name: 'purpose', value: purpose }],
        }),
        signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
      })

      if (!response.ok) {
        await response.text()
        throw new AppError(502, 'EMAIL_SEND_FAILED', 'Không thể gửi email lúc này. Vui lòng thử lại.')
      }

      await response.text()
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error
      }

      throw new AppError(502, 'EMAIL_SEND_FAILED', 'Không thể gửi email lúc này. Vui lòng thử lại.')
    }
  },
})

const emailService = createEmailService({
  apiKey: env.resendApiKey,
  fromEmail: env.resendFromEmail,
  fromName: env.resendFromName,
})

export const sendOtpEmail = emailService.sendOtpEmail
