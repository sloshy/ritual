import { describe, expect, test } from 'bun:test'
import { checkArchidektLink, parseArchidektDeckUrl } from '../../src/deck-sync/link'
import { checkDeckDivergence, describeDivergence } from '../../src/deck-sync/divergence'

/**
 * The two pieces of push-side safety that are pure functions: what counts as an
 * Archidekt deck URL worth linking to, and when a remote deck has moved on since
 * the local file last synced. Both are unit-tested here; the CLI wiring around
 * them is pinned in `test/integration/deck-sync-cli.test.ts`.
 */

describe('parseArchidektDeckUrl', () => {
  test('reads the deck id and canonicalizes the URL', () => {
    expect(parseArchidektDeckUrl('https://archidekt.com/decks/123456')).toEqual({
      sourceId: '123456',
      sourceUrl: 'https://archidekt.com/decks/123456',
    })
  })

  test('drops a trailing deck slug and any query string', () => {
    // The id is what the sync addresses; the slug is decoration Archidekt adds.
    expect(
      parseArchidektDeckUrl('https://archidekt.com/decks/123456/winota-stax?tab=cards'),
    ).toEqual({ sourceId: '123456', sourceUrl: 'https://archidekt.com/decks/123456' })
  })

  test('accepts a scheme-less URL, as `import` does', () => {
    expect(parseArchidektDeckUrl('archidekt.com/decks/987')).toEqual({
      sourceId: '987',
      sourceUrl: 'https://archidekt.com/decks/987',
    })
  })

  test('trims surrounding whitespace before parsing', () => {
    expect(parseArchidektDeckUrl('  https://archidekt.com/decks/5  ')).toEqual({
      sourceId: '5',
      sourceUrl: 'https://archidekt.com/decks/5',
    })
  })

  /** A rejected input and the message it must produce — the two branches differ. */
  const rejected: { label: string; value: string; expected: string }[] = [
    { label: 'an empty string', value: '   ', expected: 'An Archidekt deck URL is required.' },
    {
      label: 'another deck service',
      value: 'https://moxfield.com/decks/abc123',
      expected: '"https://moxfield.com/decks/abc123" is not an Archidekt deck URL.',
    },
    {
      label: 'an Archidekt URL that is not a deck',
      value: 'https://archidekt.com/search/decks',
      expected: '"https://archidekt.com/search/decks" is not an Archidekt deck URL.',
    },
    {
      label: 'a deck URL with no id',
      value: 'https://archidekt.com/decks/',
      expected: '"https://archidekt.com/decks/" is not an Archidekt deck URL.',
    },
    {
      label: 'a bare deck id',
      value: '123456',
      expected: '"123456" is not an Archidekt deck URL.',
    },
  ]

  for (const { label, value, expected } of rejected) {
    test(`rejects ${label} with its own message rather than throwing`, () => {
      expect(parseArchidektDeckUrl(value)).toContain(expected)
    })
  }

  test('the rejection names what a deck URL looks like', () => {
    expect(parseArchidektDeckUrl('https://example.com/x')).toContain(
      'https://archidekt.com/decks/123456',
    )
  })
})

describe('checkArchidektLink', () => {
  test('accepts a pair naming the same deck, in any URL spelling', () => {
    expect(
      checkArchidektLink({
        sourceId: '123456',
        sourceUrl: 'https://archidekt.com/decks/123456/winota-stax',
      }),
    ).toBeNull()
  })

  test('refuses a pair naming two different Archidekt decks', () => {
    // The hazard: a sync addresses deck 123 while every surface shows deck 999.
    const message = checkArchidektLink({
      sourceId: '123',
      sourceUrl: 'https://archidekt.com/decks/999',
    })
    expect(message).toContain('999')
    expect(message).toContain('123')
  })

  test('leaves a non-Archidekt source alone: its id follows another service', () => {
    expect(
      checkArchidektLink({ sourceId: 'abc123', sourceUrl: 'https://moxfield.com/decks/abc123' }),
    ).toBeNull()
  })

  test('has nothing to compare when either field is absent', () => {
    expect(checkArchidektLink({ sourceUrl: 'https://archidekt.com/decks/999' })).toBeNull()
    expect(checkArchidektLink({ sourceId: '999' })).toBeNull()
    expect(checkArchidektLink({})).toBeNull()
  })
})

describe('checkDeckDivergence', () => {
  test('reports a remote deck updated after the recorded sync', () => {
    expect(
      checkDeckDivergence({
        remoteUpdatedAt: '2026-08-02T12:00:00.000Z',
        syncedUpdatedAt: '2026-08-01T12:00:00.000Z',
      }),
    ).toEqual({
      kind: 'diverged',
      divergence: {
        remoteUpdatedAt: '2026-08-02T12:00:00.000Z',
        syncedUpdatedAt: '2026-08-01T12:00:00.000Z',
      },
    })
  })

  test('the message names both timestamps and both ways forward', () => {
    const message = describeDivergence({
      remoteUpdatedAt: '2026-08-02T12:00:00.000Z',
      syncedUpdatedAt: '2026-08-01T12:00:00.000Z',
    })
    expect(message).toContain('2026-08-02T12:00:00.000Z')
    expect(message).toContain('2026-08-01T12:00:00.000Z')
    expect(message).toContain('pull first')
    expect(message).toContain('--force')
  })

  test('a remote older than the sync is clean', () => {
    expect(
      checkDeckDivergence({
        remoteUpdatedAt: '2026-07-01T00:00:00.000Z',
        syncedUpdatedAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toEqual({ kind: 'clean' })
  })

  test('the recorded stamp itself is not divergence', () => {
    // The last sync copied the remote's own value, so equal must pass — this is
    // exactly the state a clean sync leaves behind.
    const stamp = '2026-08-01T00:00:00.000Z'
    expect(checkDeckDivergence({ remoteUpdatedAt: stamp, syncedUpdatedAt: stamp })).toEqual({
      kind: 'clean',
    })
  })

  test('a deck with no recorded baseline reads as unsynced, not clean', () => {
    for (const syncedUpdatedAt of [null, undefined, '']) {
      expect(
        checkDeckDivergence({ remoteUpdatedAt: '2026-08-02T12:00:00.000Z', syncedUpdatedAt }),
      ).toEqual({ kind: 'unsynced' })
    }
  })

  test('an absent or unreadable remote timestamp is unknown, not clean', () => {
    // The caller warns on this and pushes anyway; conflating it with "clean"
    // is what would let a response-shape change disable the guard in silence.
    for (const remoteUpdatedAt of [undefined, '', 'not a date']) {
      const result = checkDeckDivergence({
        remoteUpdatedAt,
        syncedUpdatedAt: '2026-08-01T00:00:00.000Z',
      })
      expect(result.kind).toBe('unknown')
    }
  })

  test('a hand-edited, unreadable baseline is unknown too', () => {
    const result = checkDeckDivergence({
      remoteUpdatedAt: '2026-08-01T00:00:00.000Z',
      syncedUpdatedAt: 'yesterday',
    })
    expect(result).toEqual({
      kind: 'unknown',
      reason: `The deck's sourceUpdatedAt is not a readable timestamp ("yesterday")`,
    })
  })

  test('compares instants rather than strings', () => {
    // Same moment, different offsets: a string comparison would call this
    // divergence.
    expect(
      checkDeckDivergence({
        remoteUpdatedAt: '2026-08-01T12:00:00.000Z',
        syncedUpdatedAt: '2026-08-01T08:00:00.000-04:00',
      }),
    ).toEqual({ kind: 'clean' })
  })
})
