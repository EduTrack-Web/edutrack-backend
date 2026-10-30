import { AppError } from '../../shared/errors/app-error.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,64}$/

export const normalizeEmail = (value: string): string => value.trim().toLowerCase()
export const normalizeIdentifier = (value: string): string => value.trim().toLowerCase()

export const emailError = (email: string): string | undefined =>
  !emailPattern.test(email) || email.length > 254 ? 'Email không hợp lệ. Ví dụ: ten@example.com.' : undefined

export const passwordError = (password: string): string | undefined =>
  !passwordPattern.test(password)
    ? 'Mật khẩu phải dài 8–64 ký tự, có chữ hoa, chữ thường, số, ký tự đặc biệt và không có khoảng trắng.'
    : undefined

export const validateEmail = (email: string): void => {
  const error = emailError(email)
  if (error) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { email: error })
  }
}

export const validatePassword = (password: string, field = 'password'): void => {
  const error = passwordError(password)
  if (error) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', {
      [field]: error,
    })
  }
}

export const requiredStrings = <Labels extends Readonly<Record<string, string>>>(
  body: unknown,
  labels: Labels,
): { [Field in keyof Labels]: string } => {
  const source = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const values: Partial<Record<keyof Labels, string>> = {}
  const errors: Record<string, string> = {}

  for (const field of Object.keys(labels) as Array<keyof Labels>) {
    const value = source[String(field)]
    if (typeof value !== 'string' || value.trim() === '') errors[String(field)] = `Vui lòng nhập ${labels[field]}.`
    else values[field] = value.trim()
  }
  if (Object.keys(errors).length > 0) throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', errors)
  return values as { [Field in keyof Labels]: string }
}

export const requiredString = (value: unknown, field: string, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(422, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { [field]: `Vui lòng nhập ${label}.` })
  }
  return value.trim()
}
