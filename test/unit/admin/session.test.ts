import { describe, test, expect } from 'bun:test'
import {
  createSession,
  validateSession,
  destroySession,
  parseSessionCookie,
  buildSessionCookie,
  buildExpiredSessionCookie,
  getSessionCookieName,
} from '../../../src/admin/session'

describe('session manager', () => {
  test('createSession returns a session with token', () => {
    const session = createSession('admin', '127.0.0.1')
    expect(session.token).toBeString()
    expect(session.token.length).toBe(64) // 32 bytes hex
    expect(session.username).toBe('admin')
    expect(session.ip).toBe('127.0.0.1')
    expect(session.expiresAt).toBeGreaterThan(Date.now())
  })

  test('validateSession accepts a valid session', () => {
    const session = createSession('admin', '127.0.0.1')
    const found = validateSession(session.token)
    expect(found).not.toBeNull()
    expect(found!.username).toBe('admin')
  })

  test('validateSession rejects an unknown token', () => {
    const found = validateSession('nonexistent-token')
    expect(found).toBeNull()
  })

  test('destroySession invalidates a session', () => {
    const session = createSession('admin', '127.0.0.1')
    expect(validateSession(session.token)).not.toBeNull()
    destroySession(session.token)
    expect(validateSession(session.token)).toBeNull()
  })

  test('parseSessionCookie extracts token from cookie header', () => {
    const name = getSessionCookieName()
    const token = parseSessionCookie(`${name}=abc123; other=value`)
    expect(token).toBe('abc123')
  })

  test('parseSessionCookie returns null for missing cookie', () => {
    expect(parseSessionCookie(null)).toBeNull()
    expect(parseSessionCookie('other=value')).toBeNull()
  })

  test('buildSessionCookie creates a valid Set-Cookie string', () => {
    const cookie = buildSessionCookie('mytoken')
    expect(cookie).toContain('ritual_session=mytoken')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=')
  })

  test('buildExpiredSessionCookie sets Max-Age to 0', () => {
    const cookie = buildExpiredSessionCookie()
    expect(cookie).toContain('Max-Age=0')
  })
})
