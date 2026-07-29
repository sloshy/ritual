import { describe, expect, test } from 'bun:test'
import { isValidListSlug, parseListTarget, parseSlugFromUrl } from '../../../src/admin/api/target'

/**
 * The shared slug predicate. A slug names a single file inside its list
 * directory, so path separators and NUL bytes are refused before
 * `resolveListFile` ever sees them. Shared by `parseListTarget` (path segment)
 * and `parseCardIndexFilters` (query parameter), which keep their own error
 * wording.
 *
 * Deliberately narrow: this is a character check, not a traversal check.
 * Refusing an escape that needs no separator (`..`) stays `resolveListFile`'s
 * job, which resolves the path and confirms it is inside the directory.
 */

/** A GET request at `path`, which is all either parser reads. */
function get(path: string): Request {
  return new Request(`http://localhost${path}`)
}

describe('parseSlugFromUrl', () => {
  test('decodes the slug of a /api/<area>/:slug route', () => {
    expect(parseSlugFromUrl(get('/api/deck/my%20deck'))).toEqual({ ok: true, slug: 'my deck' })
  })

  test('a missing segment is refused', () => {
    // `isValidListSlug('')` is deliberately true — an empty slug is caught by
    // the presence guard, not the character check, so this pins the guard.
    expect(parseSlugFromUrl(get('/api/deck/'))).toEqual({
      ok: false,
      message: 'List slug is required',
    })
  })

  test('a slug carrying a path separator is refused', () => {
    expect(parseSlugFromUrl(get(`/api/deck/${encodeURIComponent('../secret')}`))).toEqual({
      ok: false,
      message: 'Invalid list slug',
    })
  })
})

describe('parseListTarget', () => {
  test('parses the type and slug of a /api/<area>/:type/:slug route', () => {
    expect(parseListTarget(get('/api/history/collection/binder'))).toEqual({
      type: 'collection',
      slug: 'binder',
    })
  })

  test.each([
    ['an unknown type', '/api/history/binder/x', 'Invalid or missing list type'],
    ['a missing slug', '/api/history/deck/', 'List slug is required'],
    [
      'a slug with a separator',
      `/api/history/deck/${encodeURIComponent('../secret')}`,
      'Invalid list slug',
    ],
  ])('%s is refused with its own message', (_label, path, message) => {
    expect(parseListTarget(get(path))).toBe(message)
  })
})

describe('isValidListSlug', () => {
  test.each(['binder', 'my-deck', 'Winota Stax', 'deck.2026', 'wanted_list'])(
    'accepts %s',
    (slug) => {
      expect(isValidListSlug(slug)).toBeTrue()
    },
  )

  test.each([
    ['a forward slash', '../decks/secret'],
    ['a bare separator', 'a/b'],
    ['a backslash', 'decks\\evil'],
    ['a NUL byte', 'binder\0.md'],
  ])('rejects %s', (_label, slug) => {
    expect(isValidListSlug(slug)).toBeFalse()
  })

  test.each([
    ['a bare ..', '..'],
    ['the empty string', ''],
  ])('passes %s through — a separator-free value is not this check’s business', (_label, slug) => {
    expect(isValidListSlug(slug)).toBeTrue()
  })
})
