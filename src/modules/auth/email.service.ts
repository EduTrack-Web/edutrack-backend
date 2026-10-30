import nodemailer from 'nodemailer'

import { env } from '../../config/env.js'
import { AppError } from '../../shared/errors/app-error.js'

const getTransporter = () => {
  if (!env.emailUser || !env.emailAppPassword) {
    throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Dịch vụ email chưa được cấu hình.')
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.emailUser, pass: env.emailAppPassword },
  })
}

export const sendOtpEmail = async (email: string, code: string, purpose: string): Promise<void> => {
  const subject = purpose === 'password-reset' ? 'Mã đặt lại mật khẩu EduTrack' : 'Mã xác thực EduTrack'
  await getTransporter().sendMail({
    from: `EduTrack <${env.emailUser}>`,
    to: email,
    subject,
    text: `Mã OTP của bạn là ${code}. Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.`,
    html: `<div style="font-family:Arial,sans-serif;color:#021024"><h2>${subject}</h2><p>Mã OTP của bạn:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px;color:#052659">${code}</p><p>Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.</p></div>`,
  })
}
