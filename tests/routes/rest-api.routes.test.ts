import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import { createApp } from '@/app.js'

const withServer = async (run: (baseUrl: string) => Promise<void>): Promise<void> => {
  const server = createApp().listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

test('serves only the RESTful API base path', async () => {
  await withServer(async (baseUrl) => {
    const restfulResponse = await fetch(`${baseUrl}/api/v1/auth/csrf-token`)
    const legacyResponse = await fetch(`${baseUrl}/v1/api/auth/csrf`)

    assert.equal(restfulResponse.status, 200)
    assert.equal(legacyResponse.status, 404)
    assert.equal((await restfulResponse.json() as { success?: unknown }).success, true)
  })
})

test('registers protected RESTful resources instead of returning not found', async () => {
  await withServer(async (baseUrl) => {
    const paths = [
      '/api/v1/users/me',
      '/api/v1/notes',
      '/api/v1/note-tags',
      '/api/v1/trash/notes',
      '/api/v1/chat/groups',
      '/api/v1/calendar/events',
      '/api/v1/calendar/preferences',
      '/api/v1/calendar/google/authorizations',
      '/api/v1/calendar/google/integrations',
      '/api/v1/calendar/google/conflicts',
      '/api/v1/calendar/lunar-dates?from=2026-01-01&to=2026-01-31',
      '/api/v1/calendar/holidays?from=2026-01-01&to=2026-01-31',
      '/api/v1/notifications',
    ]

    for (const path of paths) {
      const response = await fetch(`${baseUrl}${path}`)
      assert.equal(response.status, 401, `${path} should require authentication`)
    }
  })
})

test('does not expose legacy action names under the RESTful base path', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST' })
    assert.equal(response.status, 404)
  })
})

test('handles Google Calendar OAuth callback inside calendar module without 404', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/calendar/google/callback?error=access_denied`, {
      redirect: 'manual',
    })
    assert.equal(response.status, 302)
    const location = response.headers.get('location') ?? ''
    assert.match(location, /\/calendar\?googleSyncError=/)
  })
})
