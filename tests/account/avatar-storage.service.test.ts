import assert from 'node:assert/strict'
import test from 'node:test'

import { AVATAR_CLOUDINARY_FOLDER, buildAvatarPublicId } from '../../src/shared/config/avatar-storage.config.js'
import { isGoogleHostedAvatarUrl, shouldImportGoogleAvatar } from '../../src/shared/services/avatar-storage.service.js'

test('uses a stable Cloudinary path for each user avatar', () => {
  assert.equal(AVATAR_CLOUDINARY_FOLDER, 'edutrack/avatars')
  assert.equal(buildAvatarPublicId('user-id'), 'user_user-id')
})

test('accepts only HTTPS Google-hosted avatar URLs', () => {
  assert.equal(isGoogleHostedAvatarUrl('https://lh3.googleusercontent.com/a/example'), true)
  assert.equal(isGoogleHostedAvatarUrl('http://lh3.googleusercontent.com/a/example'), false)
  assert.equal(isGoogleHostedAvatarUrl('https://googleusercontent.com.evil.example/avatar'), false)
  assert.equal(isGoogleHostedAvatarUrl('not-a-url'), false)
})

test('imports Google avatars only when no custom avatar has replaced them', () => {
  const googleAvatar = 'https://lh3.googleusercontent.com/a/example'

  assert.equal(shouldImportGoogleAvatar(undefined, googleAvatar), true)
  assert.equal(shouldImportGoogleAvatar(googleAvatar, googleAvatar), true)
  assert.equal(shouldImportGoogleAvatar('https://res.cloudinary.com/demo/avatar.jpg', googleAvatar), false)
  assert.equal(shouldImportGoogleAvatar('/uploads/avatars/custom.png', googleAvatar), false)
})
