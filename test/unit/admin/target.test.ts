import { describe, expect, test } from 'bun:test'
import { isValidListSlug } from '../../../src/admin/api/target'

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
