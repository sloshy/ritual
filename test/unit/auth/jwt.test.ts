import { describe, test, expect } from 'bun:test'
import { decodeJwtPayload, getJwtExpiration } from '../../../src/auth/jwt'

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('decodeJwtPayload', () => {
  test('decodes the payload of a well-formed JWT', () => {
    const token = makeJwt({ token_type: 'refresh', exp: 1772736829, iat: 1769284429 })
    expect(decodeJwtPayload(token)).toEqual({
      token_type: 'refresh',
      exp: 1772736829,
      iat: 1769284429,
    })
  })

  test('returns null when the token does not have three segments', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('only.two')).toBeNull()
  })

  test('returns null when the payload is not valid JSON', () => {
    const header = Buffer.from('{}').toString('base64url')
    const garbage = Buffer.from('not json').toString('base64url')
    expect(decodeJwtPayload(`${header}.${garbage}.sig`)).toBeNull()
  })
})

describe('getJwtExpiration', () => {
  test('returns the exp claim as a Date (seconds since epoch)', () => {
    const exp = 1772736829
    const token = makeJwt({ exp })
    expect(getJwtExpiration(token)?.getTime()).toBe(exp * 1000)
  })

  test('returns null when there is no exp claim', () => {
    expect(getJwtExpiration(makeJwt({ token_type: 'access' }))).toBeNull()
  })

  test('returns null for a malformed token', () => {
    expect(getJwtExpiration('garbage')).toBeNull()
  })
})
