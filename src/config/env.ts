const DEFAULT_PORT = 8888
const DEFAULT_CLIENT_ORIGIN = 'http://localhost:5173'

const parsePort = (value: string | undefined): number => {
  if (value === undefined) {
    return DEFAULT_PORT
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  return port
}

const parseOrigins = (value: string | undefined): string[] => {
  const origins = value?.split(',').map((origin) => origin.trim()).filter(Boolean)
  return origins?.length ? origins : [DEFAULT_CLIENT_ORIGIN]
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parsePort(process.env.PORT),
  mongoUri: process.env.MONGODB_URI,
  clientOrigins: parseOrigins(process.env.CLIENT_ORIGINS),
  frontendUrl: process.env.FRONTEND_URL ?? DEFAULT_CLIENT_ORIGIN,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  emailUser: process.env.EMAIL_USER,
  emailAppPassword: process.env.EMAIL_APP_PASSWORD,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,
} as const
