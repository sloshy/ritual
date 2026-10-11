import { describe, expect, test } from 'bun:test'
import {
  cancelledReason,
  countUnstartedItems,
  describeRateLimitWait,
  describeSkippedChanges,
  noChangesReason,
  unreadableConsequence,
  type SyncChangeFilter,
} from '../../src/sync/common'
import { reasonFields, renderSyncMessage } from '../../src/sync/message'
import { withSyntheticLocale } from '../helpers/sync-text'

/**
 * The vocabulary every sync speaks. The change filter is destination-relative: a
 * diff always reads old (destination) → new (source), so `added` and quantity
 * increases add cards to the destination whichever direction built the diff.
 */

describe('describeSkippedChanges', () => {
  test('names the side that was left out, pluralized', () => {
    expect(describeSkippedChanges('additions', 3)?.message).toBe(
      'Skipped 3 removals (applying additions only).',
    )
    expect(describeSkippedChanges('removals', 1)?.message).toBe(
      'Skipped 1 addition (applying removals only).',
    )
  })

  test('says nothing when there is no filter or nothing was skipped', () => {
    const filters: SyncChangeFilter[] = ['additions', 'removals']
    for (const filter of filters) {
      expect(describeSkippedChanges(filter, 0)).toBeNull()
    }
    expect(describeSkippedChanges(undefined, 5)).toBeNull()
  })
})

describe('unreadableConsequence', () => {
  test('a deck sync rewrites its file whichever way it runs', () => {
    const pull = unreadableConsequence('deck', 'pull')
    expect(pull).toBe('Syncing rewrites the deck file, so these lines would be removed:')
    expect(unreadableConsequence('deck', 'push')).toBe(pull)
  })

  test('a collection pull loses the lines, a push loses the cards', () => {
    expect(unreadableConsequence('collection', 'pull')).toBe(
      'A pull rewrites the list file, so these lines would be removed:',
    )
    expect(unreadableConsequence('collection', 'push')).toContain(
      'removed from your Archidekt collection',
    )
  })
})

describe('describeRateLimitWait', () => {
  test('renders the full sentence', () => {
    expect(describeRateLimitWait({ waitMs: 250, retry: 1, maxRetries: 5 }).message).toBe(
      'Rate limited by Archidekt — waiting 0.3 seconds before retry 1 of 5.',
    )
  })

  const waitCases: [waitMs: number, wait: string][] = [
    [2000, '2 seconds'], // a whole second never renders as 2.0
    [2440, '2.5 seconds'], // round UP, not to nearest
    [250, '0.3 seconds'],
    [101, '0.2 seconds'], // the tenth boundary rounds up…
    [100, '0.1 seconds'], // …and an exact tenth stays put
    [0, '0.1 seconds'], // the floor: a wait never reads as zero seconds
    [60_000, '1 minute'], // the Retry-After cap reads as the duration it is
  ]

  for (const [waitMs, wait] of waitCases) {
    test(`${waitMs}ms reads as ${wait}`, () => {
      expect(describeRateLimitWait({ waitMs, retry: 1, maxRetries: 5 }).message).toContain(
        `waiting ${wait} before`,
      )
    })
  }
})

describe('item outcomes', () => {
  test('pins the English reasons a script used to read', () => {
    expect(cancelledReason().message).toBe('cancelled before it started')
    expect(noChangesReason().message).toBe('no changes')
  })

  test('counts an item the cancellation never reached by its outcome alone', () => {
    expect(countUnstartedItems([{ status: 'skipped', outcome: 'cancelled' }])).toBe(1)
  })

  test('does not count an item for carrying the old English reason text', () => {
    expect(
      countUnstartedItems([{ status: 'skipped', reason: 'cancelled before it started' }]),
    ).toBe(0)
  })

  test('does not count an item a refused run never reached, nor an ordinary skip', () => {
    expect(
      countUnstartedItems([
        { status: 'skipped', outcome: 'not-run' },
        { status: 'skipped', reason: 'you do not own Archidekt deck 1' },
        { status: 'synced', outcome: 'changed' },
      ]),
    ).toBe(0)
  })

  test('keeps the wire reason English under a translated UI locale', () => {
    withSyntheticLocale('xx', { 'domain.sync.reasonCancelled': 'xx-cancelled' }, () => {
      // Vacuity guard: the locale really is in force.
      expect(renderSyncMessage(cancelledReason())).toBe('xx-cancelled')
      expect(reasonFields(cancelledReason())).toEqual({
        reason: 'cancelled before it started',
        reasonKey: 'domain.sync.reasonCancelled',
      })
    })
  })
})
