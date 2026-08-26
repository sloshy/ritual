import { describe, expect, test } from 'bun:test'
import { matchRoute } from '../../src/util/routing'

describe('matchRoute', () => {
  test.each([
    ['an exact path', '/api/status', '/api/status', true],
    ['a parameter segment', '/api/deck/:slug', '/api/deck/burn', true],
    ['a parameter against two segments', '/api/deck/:slug', '/api/deck/burn/save', false],
    ['a shorter request', '/api/deck/:slug', '/api/deck', false],
    ['a different literal', '/api/deck/:slug', '/api/wanted/burn', false],
  ] as [string, string, string, boolean][])('%s', (_label, pattern, requestPath, expected) => {
    expect(matchRoute(pattern, requestPath)).toBe(expected)
  })

  test.each([
    ['one segment', '/art/bolt.png', true],
    ['a nested path', '/art/proxies/deep/bolt.png', true],
    // The art route serves files, so the bare directory is not a match — it
    // would otherwise shadow the SPA fallback with a guaranteed 404.
    ['no segment at all', '/art', false],
    ['a different prefix', '/images/bolt.png', false],
  ] as [string, string, boolean][])('a trailing wildcard matches %s', (_label, req, expected) => {
    expect(matchRoute('/art/*', req)).toBe(expected)
  })
})
