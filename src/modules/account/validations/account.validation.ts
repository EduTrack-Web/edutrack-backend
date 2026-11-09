import { AppError } from '../../../shared/errors/app-error.js'
import type { ChangePasswordDto, ProfileSetupDto, UpdateProfileDto } from '../types/account.types.js'

export const USERNAME_REGEX = /^[a-z0-9_-]{3,30}$/
export const VIETNAM_PHONE_REGEX = /^(0[3|5|7|8|9])[0-9]{8}$/
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,64}$/
export const VALID_USER_TYPES = ['student', 'pupil', 'worker', 'teacher', 'other'] as const

export const VIETNAMESE_ACCENT_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/

export const validateUsernameFormat = (username: string): string | null => {
  const trimmed = username.trim()
  if (!trimmed) {
    return 'Tên đăng nhập không được để trống.'
  }

  const hasSpace = /\s/.test(username)
  const hasAccent = VIETNAMESE_ACCENT_REGEX.test(username)

  if (hasSpace && hasAccent) {
    return 'Tên đăng nhập không được chứa khoảng trắng và dấu tiếng Việt.'
  }

  if (hasSpace) {
    return 'Tên đăng nhập không được chứa khoảng trắng.'
  }

  if (hasAccent) {
    return 'Tên đăng nhập không được chứa dấu tiếng Việt.'
  }

  if (trimmed.length < 3 || trimmed.length > 30) {
    return 'Tên đăng nhập phải có độ dài từ 3 đến 30 ký tự.'
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return 'Tên đăng nhập chỉ gồm chữ cái không dấu, chữ số (0-9), gạch ngang (-) hoặc gạch dưới (_).'
  }

  return null
}

export const validateUpdateProfile = (body: unknown): UpdateProfileDto => {
  if (typeof body !== 'object' || body === null) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu yêu cầu không hợp lệ.')
  }

  const payload = body as Record<string, unknown>
  const errors: Record<string, string> = {}
  const sanitized: UpdateProfileDto = {}

  // 1. Validate Họ và tên (fullName)
  if ('fullName' in payload) {
    if (typeof payload.fullName !== 'string' || payload.fullName.trim() === '') {
      errors.fullName = 'Vui lòng nhập họ và tên.'
    } else {
      const trimmed = payload.fullName.trim()
      if (trimmed.length < 2 || trimmed.length > 50) {
        errors.fullName = 'Họ và tên phải từ 2 đến 50 ký tự.'
      } else {
        sanitized.fullName = trimmed
      }
    }
  }

  // 2. Validate Tên đăng nhập (username)
  if ('username' in payload && payload.username !== undefined && payload.username !== null) {
    if (typeof payload.username !== 'string') {
      errors.username = 'Tên đăng nhập không hợp lệ.'
    } else {
      const err = validateUsernameFormat(payload.username)
      if (err) {
        errors.username = err
      } else {
        sanitized.username = payload.username.trim().toLowerCase()
      }
    }
  }

  // 3. Validate Số điện thoại (phone)
  if ('phone' in payload && payload.phone !== undefined && payload.phone !== null) {
    if (typeof payload.phone !== 'string') {
      errors.phone = 'Số điện thoại không hợp lệ.'
    } else {
      const trimmedPhone = payload.phone.trim()
      if (trimmedPhone !== '' && !VIETNAM_PHONE_REGEX.test(trimmedPhone)) {
        errors.phone = 'Số điện thoại không hợp lệ. Vui lòng nhập 10 chữ số (ví dụ: 0912345678).'
      } else {
        sanitized.phone = trimmedPhone
      }
    }
  }

  // 4. Validate Avatar URL
  if ('avatarUrl' in payload && payload.avatarUrl !== undefined && payload.avatarUrl !== null) {
    if (typeof payload.avatarUrl === 'string') {
      sanitized.avatarUrl = payload.avatarUrl.trim()
    }
  }

  // 5. Validate Vai trò người dùng (userType)
  if ('userType' in payload && payload.userType !== undefined && payload.userType !== null) {
    if (typeof payload.userType !== 'string' || !VALID_USER_TYPES.includes(payload.userType as typeof VALID_USER_TYPES[number])) {
      errors.userType = 'Vai trò người dùng không hợp lệ.'
    } else {
      sanitized.userType = payload.userType as UpdateProfileDto['userType']
    }
  }

  // 6. Validate Đơn vị / Trường học (organization)
  if ('organization' in payload && payload.organization !== undefined && payload.organization !== null) {
    if (typeof payload.organization !== 'string') {
      errors.organization = 'Tên trường học hoặc đơn vị không hợp lệ.'
    } else {
      const trimmedOrg = payload.organization.trim()
      if (trimmedOrg.length > 100) {
        errors.organization = 'Tên trường học hoặc đơn vị không được vượt quá 100 ký tự.'
      } else {
        sanitized.organization = trimmedOrg
      }
    }
  }

  // 7. Validate Lĩnh vực / Chuyên ngành (fieldOfStudy)
  if ('fieldOfStudy' in payload && payload.fieldOfStudy !== undefined && payload.fieldOfStudy !== null) {
    if (typeof payload.fieldOfStudy !== 'string') {
      errors.fieldOfStudy = 'Lĩnh vực hoặc chuyên ngành không hợp lệ.'
    } else {
      const trimmedField = payload.fieldOfStudy.trim()
      if (trimmedField.length > 100) {
        errors.fieldOfStudy = 'Lĩnh vực quan tâm không được vượt quá 100 ký tự.'
      } else {
        sanitized.fieldOfStudy = trimmedField
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', errors)
  }

  return sanitized
}

export const validateProfileSetup = (body: unknown): ProfileSetupDto => {
  if (typeof body !== 'object' || body === null) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu yêu cầu không hợp lệ.')
  }

  const payload = body as Record<string, unknown>
  const errors: Record<string, string> = {}
  const sanitized: ProfileSetupDto = {}

  // 1. Validate userType (Tùy chọn)
  if ('userType' in payload && payload.userType !== undefined && payload.userType !== null && payload.userType !== '') {
    if (typeof payload.userType !== 'string' || !VALID_USER_TYPES.includes(payload.userType as typeof VALID_USER_TYPES[number])) {
      errors.userType = 'Vai trò người dùng không hợp lệ.'
    } else {
      sanitized.userType = payload.userType as ProfileSetupDto['userType']
    }
  }

  // 2. Validate username (Tùy chọn nếu người dùng chỉnh sửa)
  if ('username' in payload && payload.username !== undefined && payload.username !== null && payload.username !== '') {
    if (typeof payload.username !== 'string') {
      errors.username = 'Tên đăng nhập không hợp lệ.'
    } else {
      const err = validateUsernameFormat(payload.username)
      if (err) {
        errors.username = err
      } else {
        sanitized.username = payload.username.trim().toLowerCase()
      }
    }
  }

  // 3. Validate organization (Tùy chọn)
  if ('organization' in payload && payload.organization !== undefined && payload.organization !== null) {
    if (typeof payload.organization !== 'string') {
      errors.organization = 'Tên trường học hoặc đơn vị không hợp lệ.'
    } else {
      const trimmedOrg = payload.organization.trim()
      if (trimmedOrg.length > 100) {
        errors.organization = 'Tên trường học hoặc đơn vị không được vượt quá 100 ký tự.'
      } else {
        sanitized.organization = trimmedOrg
      }
    }
  }

  // 4. Validate fieldOfStudy (Tùy chọn)
  if ('fieldOfStudy' in payload && payload.fieldOfStudy !== undefined && payload.fieldOfStudy !== null) {
    if (typeof payload.fieldOfStudy !== 'string') {
      errors.fieldOfStudy = 'Lĩnh vực hoặc chuyên ngành không hợp lệ.'
    } else {
      const trimmedField = payload.fieldOfStudy.trim()
      if (trimmedField.length > 100) {
        errors.fieldOfStudy = 'Lĩnh vực quan tâm không được vượt quá 100 ký tự.'
      } else {
        sanitized.fieldOfStudy = trimmedField
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', errors)
  }

  return sanitized
}

export const validateChangePassword = (body: unknown, userHasPassword = true): ChangePasswordDto => {
  if (typeof body !== 'object' || body === null) {
    throw new AppError(400, 'INVALID_BODY', 'Dữ liệu yêu cầu không hợp lệ.')
  }

  const payload = body as Record<string, unknown>
  const errors: Record<string, string> = {}

  let currentPassword = ''
  if (userHasPassword) {
    if (typeof payload.currentPassword !== 'string' || payload.currentPassword === '') {
      errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.'
    } else {
      currentPassword = payload.currentPassword
    }
  }

  let newPassword = ''
  if (typeof payload.newPassword !== 'string' || payload.newPassword === '') {
    errors.newPassword = 'Vui lòng nhập mật khẩu mới.'
  } else if (!PASSWORD_PATTERN.test(payload.newPassword)) {
    errors.newPassword = 'Mật khẩu phải dài 8–64 ký tự, có chữ hoa, chữ thường, số, ký tự đặc biệt và không có khoảng trắng.'
  } else {
    newPassword = payload.newPassword
  }

  let confirmPassword = ''
  if (typeof payload.confirmPassword !== 'string' || payload.confirmPassword === '') {
    errors.confirmPassword = 'Vui lòng nhập xác nhận mật khẩu mới.'
  } else if (payload.confirmPassword !== newPassword) {
    errors.confirmPassword = 'Mật khẩu xác nhận không khớp.'
  } else {
    confirmPassword = payload.confirmPassword
  }

  if (Object.keys(errors).length > 0) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', errors)
  }

  return {
    ...(userHasPassword ? { currentPassword } : {}),
    newPassword,
    confirmPassword,
    logoutOtherDevices: Boolean(payload.logoutOtherDevices),
  }
}
