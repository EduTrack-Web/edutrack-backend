import { env } from '@/config/env.js'

export const GOOGLE_CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

export const hasGoogleCalendarEventPermission = (scope: unknown): boolean =>
  typeof scope === 'string' && scope.split(/\s+/).some((item) =>
    item === GOOGLE_CALENDAR_EVENTS_SCOPE || item === 'https://www.googleapis.com/auth/calendar',
  )

const getProjectNumber = (clientId: string): string | undefined =>
  /^(\d+)-[a-z\d]+\.apps\.googleusercontent\.com$/i.exec(clientId)?.[1]

export const isSeparateGoogleOAuthProject = (calendarClientId: string, loginClientId?: string): boolean => {
  if (calendarClientId === loginClientId) return false
  if (!loginClientId) return true
  const calendarProject = getProjectNumber(calendarClientId)
  const loginProject = getProjectNumber(loginClientId)
  return Boolean(calendarProject && loginProject && calendarProject !== loginProject)
}

export const getCalendarOAuthCredentials = () => {
  const clientId = env.googleCalendarClientId
  const clientSecret = env.googleCalendarClientSecret
  return clientId && clientSecret && isSeparateGoogleOAuthProject(clientId, env.googleClientId?.trim())
    ? { clientId, clientSecret }
    : null
}
