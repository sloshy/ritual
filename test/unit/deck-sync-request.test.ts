import { describe, expect, test } from 'bun:test'
import {
  describeRun,
  parseDeckSyncBody,
  parseDeckSyncQuery,
  type DeckSyncRequest,
} from '../../src/admin/api/deck-sync'
import type { DeckSyncReport } from '../../src/deck-sync/engine'

/**
 * Validation and summary text for the admin sync endpoints. The sync itself is
 * the engine's business; these pin what the handlers accept and what they say
 * about a finished run.
 */

type RejectedCase = { label: string; body: unknown; expected: string }

describe('parseDeckSyncBody', () => {
  test('defaults to every deck, a live run, and refusing unreadable lines', () => {
    expect(parseDeckSyncBody({ direction: 'pull' })).toEqual({
      direction: 'pull',
      decks: [],
      dryRun: false,
      ignoreUnreadableLines: false,
    } satisfies DeckSyncRequest)
  })

  test('keeps the requested decks, trimmed, and both flags', () => {
    expect(
      parseDeckSyncBody({
        direction: 'push',
        decks: ['  Winota Stax ', '', '  '],
        dryRun: true,
        ignoreUnreadableLines: true,
      }),
    ).toEqual({
      direction: 'push',
      decks: ['Winota Stax'],
      dryRun: true,
      ignoreUnreadableLines: true,
    } satisfies DeckSyncRequest)
  })

  test('accepts a direction in any casing, as the CLI flag parser does', () => {
    expect(parseDeckSyncBody({ direction: 'Pull' })).toEqual({
      direction: 'pull',
      decks: [],
      dryRun: false,
      ignoreUnreadableLines: false,
    } satisfies DeckSyncRequest)
  })

  test('keeps a change filter, in any casing', () => {
    expect(parseDeckSyncBody({ direction: 'pull', only: 'Additions' })).toEqual({
      direction: 'pull',
      decks: [],
      dryRun: false,
      ignoreUnreadableLines: false,
      only: 'additions',
    } satisfies DeckSyncRequest)
  })

  test('treats an absent or empty change filter as "apply everything"', () => {
    // A query string with no `only` param, and a form control left unset, both
    // arrive here as nothing to filter by rather than as a bad value.
    for (const only of [undefined, null, '']) {
      const parsed = parseDeckSyncBody({ direction: 'pull', only })
      expect(typeof parsed).not.toBe('string')
      expect((parsed as DeckSyncRequest).only).toBeUndefined()
    }
  })

  const rejected: RejectedCase[] = [
    { label: 'a non-object body', body: 'pull', expected: 'Invalid request body' },
    { label: 'a null body', body: null, expected: 'Invalid request body' },
    { label: 'an array body', body: [], expected: 'Invalid request body' },
    {
      label: 'a missing direction',
      body: {},
      expected: 'direction is required (push or pull)',
    },
    {
      label: 'an unknown direction',
      body: { direction: 'sideways' },
      expected: "Invalid direction 'sideways'. Use one of: push, pull.",
    },
    {
      label: 'decks that are not strings',
      body: { direction: 'pull', decks: [7] },
      expected: 'decks must be an array of deck names',
    },
    {
      label: 'a non-array decks field',
      body: { direction: 'pull', decks: 'Winota Stax' },
      expected: 'decks must be an array of deck names',
    },
    {
      label: 'a non-boolean dryRun',
      body: { direction: 'pull', dryRun: 'yes' },
      expected: 'dryRun must be a boolean',
    },
    {
      label: 'a non-boolean ignoreUnreadableLines',
      body: { direction: 'pull', ignoreUnreadableLines: 'yes' },
      expected: 'ignoreUnreadableLines must be a boolean',
    },
    {
      label: 'an unknown change filter',
      body: { direction: 'pull', only: 'adds' },
      expected: "Invalid only 'adds'. Use one of: additions, removals.",
    },
    {
      label: 'a non-string change filter',
      body: { direction: 'pull', only: true },
      expected: 'only must be one of: additions, removals.',
    },
  ]

  for (const { label, body, expected } of rejected) {
    test(`rejects ${label}`, () => {
      expect(parseDeckSyncBody(body)).toBe(expected)
    })
  }
})

describe('parseDeckSyncQuery', () => {
  test('reads repeated deck params and both flags', () => {
    const params = new URLSearchParams(
      'direction=push&deck=one&deck=two&dryRun=true&ignoreUnreadableLines=true',
    )
    expect(parseDeckSyncQuery(params)).toEqual({
      direction: 'push',
      decks: ['one', 'two'],
      dryRun: true,
      ignoreUnreadableLines: true,
    } satisfies DeckSyncRequest)
  })

  test('reads the change filter, which is a string enum rather than a flag', () => {
    expect(parseDeckSyncQuery(new URLSearchParams('direction=pull&only=removals'))).toEqual({
      direction: 'pull',
      decks: [],
      dryRun: false,
      ignoreUnreadableLines: false,
      only: 'removals',
    } satisfies DeckSyncRequest)
  })

  test('rejects an unknown change filter rather than syncing everything', () => {
    expect(parseDeckSyncQuery(new URLSearchParams('direction=pull&only=everything'))).toBe(
      "Invalid only 'everything'. Use one of: additions, removals.",
    )
  })

  test('treats missing flags as a live run over every deck, refusing unreadable lines', () => {
    expect(parseDeckSyncQuery(new URLSearchParams('direction=pull'))).toEqual({
      direction: 'pull',
      decks: [],
      dryRun: false,
      ignoreUnreadableLines: false,
    } satisfies DeckSyncRequest)
  })

  test('rejects a query with no direction', () => {
    expect(parseDeckSyncQuery(new URLSearchParams('deck=one'))).toBe(
      'direction is required (push or pull)',
    )
  })

  // Both flags decide whether files are rewritten, so an unreadable value is an
  // error rather than a silent "no".
  const booleanFlags = ['dryRun', 'ignoreUnreadableLines'] as const
  for (const flag of booleanFlags) {
    test(`rejects a ${flag} value it cannot read rather than running for real`, () => {
      expect(parseDeckSyncQuery(new URLSearchParams(`direction=pull&${flag}=1`))).toBe(
        `${flag} must be 'true' or 'false'`,
      )
    })
  }
})

describe('describeRun', () => {
  function report(decks: DeckSyncReport['decks'], direction: 'pull' | 'push' = 'pull') {
    const failedCount = decks.filter((deck) => deck.status === 'failed').length
    const value: DeckSyncReport = { direction, decks, failedCount, unreadable: [] }
    return value
  }

  test('reports that nothing was found when no deck was touched', () => {
    expect(describeRun(report([]), false)).toBe('No Archidekt decks found to sync.')
  })

  test('counts skipped and failed decks alongside the synced ones', () => {
    const summary = describeRun(
      report([
        { name: 'A', status: 'synced' },
        { name: 'B', status: 'skipped', reason: 'not yours' },
        { name: 'C', status: 'failed', reason: 'boom' },
      ]),
      false,
    )
    expect(summary).toBe('Pulled 1 deck, 1 skipped, 1 failed.')
  })

  test("reports the report's own failedCount rather than recounting", () => {
    // The engine owns failedCount; the summary must not second-guess it.
    const value: DeckSyncReport = {
      direction: 'pull',
      decks: [{ name: 'A', status: 'synced' }],
      failedCount: 2,
      unreadable: [],
    }
    expect(describeRun(value, false)).toBe('Pulled 1 deck, 2 failed.')
  })

  test('names the direction, and says "previewed" for a dry run', () => {
    const decks: DeckSyncReport['decks'] = [
      { name: 'A', status: 'synced' },
      { name: 'B', status: 'synced' },
    ]
    expect(describeRun(report(decks, 'push'), false)).toBe('Pushed 2 decks.')
    expect(describeRun(report(decks, 'push'), true)).toBe('Previewed 2 decks.')
  })
})
