import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmailService } from '../../src/modules/auth/services/email.service.js'
import { AppError } from '../../src/shared/errors/app-error.js'

const createRequest = (response: Response) => {
  let input: string | URL | Request | undefined
  let init: RequestInit | undefined

  const request: typeof fetch = async (nextInput, nextInit) => {
    input = nextInput
    init = nextInit
    return response
  }

  return {
    request,
    getInput: () => input,
    getInit: () => init,
  }
}

test('requires the Resend API key and sender email', async () => {
  const service = createEmailService({ fromName: 'EduTrack' })

  await assert.rejects(
    service.sendOtpEmail('student@example.com', '123456', 'registration'),
    (error: unknown) => error instanceof AppError && error.code === 'EMAIL_NOT_CONFIGURED',
  )
})

test('sends OTP through the Resend HTTPS API', async () => {
  const response = new Response(JSON.stringify({ id: 'email-id' }), { status: 200 })
  const request = createRequest(response)
  const service = createEmailService(
    {
      apiKey: 'test_api_key',
      fromEmail: 'noreply@example.com',
      fromName: 'EduTrack',
    },
    request.request,
  )

  await service.sendOtpEmail('student@example.com', '123456', 'registration')

  assert.equal(String(request.getInput()), 'https://api.resend.com/emails')
  assert.equal(request.getInit()?.method, 'POST')
  assert.equal(new Headers(request.getInit()?.headers).get('Authorization'), 'Bearer test_api_key')

  const body = JSON.parse(String(request.getInit()?.body)) as unknown
  assert.ok(typeof body === 'object' && body !== null)
  assert.deepEqual(Reflect.get(body, 'to'), ['student@example.com'])
  assert.equal(Reflect.get(body, 'from'), 'EduTrack <noreply@example.com>')
  assert.match(String(Reflect.get(body, 'text')), /123456/)
})

test('returns a stable application error when Resend rejects the request', async () => {
  const request = createRequest(new Response('provider details must stay private', { status: 429 }))
  const service = createEmailService(
    {
      apiKey: 'test_api_key',
      fromEmail: 'noreply@example.com',
      fromName: 'EduTrack',
    },
    request.request,
  )

  await assert.rejects(
    service.sendOtpEmail('student@example.com', '123456', 'password-reset'),
    (error: unknown) =>
      error instanceof AppError
      && error.statusCode === 502
      && error.code === 'EMAIL_SEND_FAILED'
      && !error.message.includes('provider details'),
  )
})
