import { describe, expect, test } from 'bun:test'
import {
  describeLink,
  describeSyncStatus,
  summarizeDeckRun,
  type DeckSyncStatusOutput,
} from '../../../src/commands/deck-sync'
import type { DeckSyncDeckResult, DeckSyncReport } from '../../../src/deck-sync/engine'
import type { DeckLinkResult } from '../../../src/deck-sync/link'

/**
 * What a text-mode `deck-sync` run prints once the engine is done: the closing
 * tally (its counterpart under `--output json` is the report itself), the link
 * confirmation, and the read-only status listing.
 */

function report(decks: DeckSyncDeckResult[]): DeckSyncReport {
  return {
    direction: 'pull',
    decks,
    failedCount: decks.filter((deck) => deck.status === 'failed').length,
    unreadable: [],
    cancelled: false,
  }
}

describe('summarizeDeckRun', () => {
  test('counts synced decks and how many of them actually changed', () => {
    const summary = summarizeDeckRun(
      report([
        { name: 'A', status: 'synced' },
        { name: 'B', status: 'synced', reason: 'no changes' },
        { name: 'C', status: 'synced', reason: 'no changes' },
      ]),
      false,
    )
    expect(summary).toBe('Synced 3 decks (1 with changes).')
  })

  test('adds the skipped and failed counts only when there are any', () => {
    const summary = summarizeDeckRun(
      report([
        { name: 'A', status: 'synced' },
        { name: 'B', status: 'skipped', reason: 'you do not own it' },
        { name: 'C', status: 'failed', reason: 'boom' },
      ]),
      false,
    )
    expect(summary).toBe('Synced 1 deck (1 with changes), 1 skipped, 1 failed.')
  })

  test('a dry run says it would sync rather than that it did', () => {
    expect(summarizeDeckRun(report([{ name: 'A', status: 'synced' }]), true)).toBe(
      '[dry-run] Would sync 1 deck (1 with changes).',
    )
  })

  test('a run that covered no decks has no tally to print', () => {
    // The engine already said "No Archidekt decks found to sync."; "Synced 0
    // decks." under it reads as a contradiction.
    expect(summarizeDeckRun(report([]), false)).toBeUndefined()
  })
})

describe('describeLink', () => {
  function link(overrides: Partial<DeckLinkResult> = {}): DeckLinkResult {
    return {
      slug: 'winota-stax',
      name: 'Winota Stax',
      sourceId: '123456',
      sourceUrl: 'https://archidekt.com/decks/123456',
      previous: null,
      dryRun: false,
      writtenFiles: [],
      ...overrides,
    }
  }

  test('names the deck, the URL, and the id it linked', () => {
    expect(describeLink(link())).toEqual([
      'Linked "Winota Stax" to https://archidekt.com/decks/123456 (deck 123456).',
    ])
  })

  test('says what the deck was linked to before, when it changes', () => {
    expect(
      describeLink(
        link({ previous: { sourceId: '99', sourceUrl: 'https://archidekt.com/decks/99' } }),
      ),
    ).toEqual([
      'Linked "Winota Stax" to https://archidekt.com/decks/123456 (deck 123456).',
      'It was linked to https://archidekt.com/decks/99.',
    ])
  })

  test('a re-link to the same URL does not claim anything changed', () => {
    expect(
      describeLink(
        link({ previous: { sourceId: '123456', sourceUrl: 'https://archidekt.com/decks/123456' } }),
      ),
    ).toHaveLength(1)
  })

  test('a dry run says it would link', () => {
    expect(describeLink(link({ dryRun: true }))[0]).toStartWith('[dry-run] Would link')
  })
})

describe('describeSyncStatus', () => {
  const status: DeckSyncStatusOutput = {
    decks: [
      {
        slug: 'winota-stax',
        name: 'Winota Stax',
        sourceId: '123456',
        sourceUrl: 'https://archidekt.com/decks/123456',
        lastSynced: '2026-08-01T00:00:00.000Z',
      },
      {
        slug: 'never',
        name: 'Never Synced',
        sourceId: '2',
        sourceUrl: 'https://archidekt.com/decks/2',
        lastSynced: null,
      },
    ],
    collection: { lastSynced: '2026-07-30T00:00:00.000Z', userId: 42, username: 'tester' },
    collectionStateError: null,
  }

  test('lists every linked deck with its URL and last sync', () => {
    const lines = describeSyncStatus(status)
    expect(lines[0]).toBe('2 decks linked to Archidekt:')
    expect(lines).toContain('  Winota Stax — https://archidekt.com/decks/123456')
    expect(lines).toContain('    last synced: 2026-08-01T00:00:00.000Z')
    expect(lines).toContain('    last synced: never')
  })

  test('closes with the account-level collection sync', () => {
    expect(describeSyncStatus(status).at(-1)).toBe(
      'Collection: last synced 2026-07-30T00:00:00.000Z (Archidekt user tester).',
    )
  })

  test('points at the link command when nothing is linked', () => {
    const lines = describeSyncStatus({ decks: [], collection: null, collectionStateError: null })
    expect(lines[0]).toContain('ritual deck-sync link')
    expect(lines.at(-1)).toBe('Collection: never synced.')
  })

  test('an unreadable state file is not reported as "never synced"', () => {
    // The distinction the read-only view exists to make: the sync may well have
    // happened; it is the record of it that cannot be read.
    const lines = describeSyncStatus({
      decks: [],
      collection: null,
      collectionStateError: 'the file is not valid JSON',
    })
    expect(lines.at(-1)).toBe('Collection: sync state unreadable (the file is not valid JSON).')
  })
})
