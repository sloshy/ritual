import { randomBytes } from 'node:crypto'

interface Session {
  token: string
  username: string
  ip: string
  createdAt: number
  expiresAt: number
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const COOKIE_NAME = 'ritual_session'

const sessions = new Map<string, Session>()

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

function pruneExpired(): void {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (now >= session.expiresAt) {
      sessions.delete(token)
    }
  }
}

export function createSession(username: string, ip: string): Session {
  pruneExpired()
  const token = generateToken()
  const now = Date.now()
  const session: Session = {
    token,
    username,
    ip,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  }
  sessions.set(token, session)
  return session
}

export function validateSession(token: string): Session | null {
  const session = sessions.get(token)
  if (!session) return null
  if (Date.now() >= session.expiresAt) {
    sessions.delete(token)
    return null
  }
  return session
}

export function destroySession(token: string): void {
  sessions.delete(token)
}

export function getSessionCookieName(): string {
  return COOKIE_NAME
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const prefix = `${COOKIE_NAME}=`
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length)
    }
  }
  return null
}

export function buildSessionCookie(token: string, secure: boolean = false): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  const secureFlag = secure ? ' Secure;' : ''
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict;${secureFlag} Max-Age=${maxAge}`
}

export function buildExpiredSessionCookie(secure: boolean = false): string {
  const secureFlag = secure ? ' Secure;' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict;${secureFlag} Max-Age=0`
}
