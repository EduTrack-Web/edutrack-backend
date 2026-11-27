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

type EmailMessage = Readonly<{
  to: string
  subject: string
  text: string
  html: string
  tags?: ReadonlyArray<Readonly<{ name: string; value: string }>>
}>

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
) => {
  const sendEmail = async (message: EmailMessage): Promise<void> => {
    if (!config.apiKey?.trim() || !config.fromEmail?.trim()) {
      throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Dịch vụ email chưa được cấu hình.')
    }

    try {
      const response = await request(RESEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: buildSender(config.fromName, config.fromEmail),
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.tags ? { tags: message.tags } : {}),
        }),
        signal: AbortSignal.timeout(EMAIL_REQUEST_TIMEOUT_MS),
      })

      await response.text()
      if (!response.ok) {
        throw new AppError(502, 'EMAIL_SEND_FAILED', 'Không thể gửi email lúc này. Vui lòng thử lại.')
      }
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error
      }

      throw new AppError(502, 'EMAIL_SEND_FAILED', 'Không thể gửi email lúc này. Vui lòng thử lại.')
    }
  }

  return {
    sendEmail,
    async sendOtpEmail(email: string, code: string, purpose: OtpPurpose): Promise<void> {
      const subject = subjectByPurpose[purpose]
      const message = `Mã OTP của bạn là ${code}. Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.`

      await sendEmail({
        to: email,
        subject,
        text: message,
        html: `<div style="font-family:Arial,sans-serif;color:#021024"><h2>${subject}</h2><p>Mã OTP của bạn:</p><p style="font-size:28px;font-weight:700;letter-spacing:8px;color:#052659">${code}</p><p>Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với bất kỳ ai.</p></div>`,
        tags: [{ name: 'purpose', value: purpose }],
      })
    },
  }
}

const emailService = createEmailService({
  apiKey: env.resendApiKey,
  fromEmail: env.resendFromEmail,
  fromName: env.resendFromName,
})

export const sendOtpEmail = emailService.sendOtpEmail

const formatDateTimeVN = (date: Date): string => {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date)
}

export const sendEventInvitationEmail = async (
  email: string,
  details: {
    title: string
    creatorName: string
    startDate: Date
    endDate: Date
    location?: string
    onlineMeetingUrl?: string
    description?: string
  },
): Promise<void> => {
  try {
    const subject = `[EduTrack] Lời mời tham gia sự kiện: ${details.title}`
    const timeText = `${formatDateTimeVN(details.startDate)} - ${formatDateTimeVN(details.endDate)}`
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #C1E8FF; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #052659; margin: 0;">EduTrack Calendar</h2>
          <p style="color: #548383; font-size: 14px; margin-top: 4px;">Lời mời tham gia sự kiện</p>
        </div>
        <div style="background-color: #F8FAFC; border-left: 4px solid #2563EB; padding: 16px; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="color: #021024; margin-top: 0; font-size: 18px;">${details.title}</h3>
          <p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Người mời:</strong> ${details.creatorName}</p>
          <p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Thời gian:</strong> ${timeText}</p>
          ${details.location ? `<p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Địa điểm:</strong> ${details.location}</p>` : ''}
          ${details.onlineMeetingUrl ? `<p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Link cuộc họp:</strong> <a href="${details.onlineMeetingUrl}" style="color: #2563EB;">${details.onlineMeetingUrl}</a></p>` : ''}
          ${details.description ? `<p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Mô tả:</strong> ${details.description}</p>` : ''}
        </div>
        <p style="font-size: 13px; color: #64748B; text-align: center;">
          Bạn có thể đăng nhập vào EduTrack để xem sự kiện và phản hồi lời mời.
        </p>
      </div>
    `

    await emailService.sendEmail({
      to: email,
      subject,
      text: `Bạn được mời tham gia sự kiện "${details.title}" bởi ${details.creatorName}. Thời gian: ${timeText}.`,
      html,
      tags: [{ name: 'purpose', value: 'event-invitation' }],
    })
  } catch (error: unknown) {
    console.warn('[EmailService] Không thể gửi email lời mời sự kiện.', error instanceof Error ? error.message : 'Unknown error')
  }
}

export const sendCategorySharedEmail = async (
  email: string,
  details: {
    categoryName: string
    sharerName: string
    roleLabel: string
    description?: string
  },
): Promise<void> => {
  try {
    const subject = `[EduTrack] Bạn được chia sẻ lịch: ${details.categoryName}`
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #C1E8FF; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #052659; margin: 0;">EduTrack Calendar</h2>
          <p style="color: #548383; font-size: 14px; margin-top: 4px;">Chia sẻ danh mục lịch</p>
        </div>
        <div style="background-color: #F8FAFC; border-left: 4px solid #2563EB; padding: 16px; border-radius: 6px; margin-bottom: 20px;">
          <h3 style="color: #021024; margin-top: 0; font-size: 18px;">${details.categoryName}</h3>
          <p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Người chia sẻ:</strong> ${details.sharerName}</p>
          <p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Quyền được cấp:</strong> ${details.roleLabel}</p>
          ${details.description ? `<p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Mô tả:</strong> ${details.description}</p>` : ''}
        </div>
        <p style="font-size: 13px; color: #64748B; text-align: center;">
          Đăng nhập vào EduTrack để xem lịch được chia sẻ hoặc rời khỏi lịch nếu bạn không muốn tham gia.
        </p>
      </div>
    `

    await emailService.sendEmail({
      to: email,
      subject,
      text: `${details.sharerName} đã chia sẻ lịch "${details.categoryName}" với bạn (quyền: ${details.roleLabel}).`,
      html,
      tags: [{ name: 'purpose', value: 'category-shared' }],
    })
  } catch (error: unknown) {
    console.warn('[EmailService] Không thể gửi email chia sẻ lịch.', error instanceof Error ? error.message : 'Unknown error')
  }
}

export const sendEventReminderEmail = async (
  email: string,
  details: {
    title: string
    minutesBefore: number
    startDate: Date
    location?: string
    onlineMeetingUrl?: string
    description?: string
  },
): Promise<void> => {
  try {
    const subject = `[Nhắc nhở EduTrack] Sự kiện "${details.title}" sắp bắt đầu`
    const timeText = formatDateTimeVN(details.startDate)
    const minutesText = details.minutesBefore >= 60
      ? `${Math.round(details.minutesBefore / 60)} giờ`
      : `${details.minutesBefore} phút`
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #C1E8FF; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #052659; margin: 0;">EduTrack - Nhắc nhở lịch</h2>
        </div>
        <div style="background-color: #EFF6FF; border-left: 4px solid #3B82F6; padding: 16px; border-radius: 6px; margin-bottom: 20px;">
          <p style="font-size: 16px; font-weight: 700; color: #1E3A8A; margin-top: 0;">Sự kiện sắp diễn ra sau ${minutesText}</p>
          <h3 style="color: #021024; margin: 8px 0; font-size: 18px;">${details.title}</h3>
          <p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Thời gian bắt đầu:</strong> ${timeText}</p>
          ${details.location ? `<p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Địa điểm:</strong> ${details.location}</p>` : ''}
          ${details.onlineMeetingUrl ? `<p style="color: #334155; margin: 8px 0; font-size: 14px;"><strong>Link cuộc họp:</strong> <a href="${details.onlineMeetingUrl}" style="color: #2563EB;">${details.onlineMeetingUrl}</a></p>` : ''}
        </div>
      </div>
    `

    await emailService.sendEmail({
      to: email,
      subject,
      text: `Nhắc nhở: Sự kiện "${details.title}" sẽ bắt đầu lúc ${timeText} (sau ${minutesText}).`,
      html,
      tags: [{ name: 'purpose', value: 'event-reminder' }],
    })
  } catch (error: unknown) {
    console.warn('[EmailService] Không thể gửi email nhắc nhở sự kiện.', error instanceof Error ? error.message : 'Unknown error')
  }
}
