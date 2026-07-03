import { describe, it, expect } from 'bun:test'
import { buildSyntheticRequest } from '../../src/synthetic-request'

describe('buildSyntheticRequest', () => {
  it('builds a bodyless GET against the given origin and path', () => {
    const req = buildSyntheticRequest('http://origin', 'GET', '/api/deck/my-deck')
    expect(req.method).toBe('GET')
    expect(req.url).toBe('http://origin/api/deck/my-deck')
    expect(req.headers.get('Content-Type')).toBeNull()
    expect(req.body).toBeNull()
  })

  it('serializes a JSON body with the matching content type', async () => {
    const req = buildSyntheticRequest('http://origin', 'POST', '/api/x', { a: 1 })
    expect(req.method).toBe('POST')
    expect(req.headers.get('Content-Type')).toBe('application/json')
    expect(await req.json()).toEqual({ a: 1 })
  })
})
