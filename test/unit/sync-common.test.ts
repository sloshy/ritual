import { describe, expect, test } from 'bun:test'
import {
  describeRateLimitWait,
  describeSkippedChanges,
  unreadableConsequence,
  type SyncChangeFilter,
} from '../../src/sync-common'

/**
 * The vocabulary every sync speaks. The change filter is destination-relative: a
 * diff always reads old (destination) → new (source), so `added` and quantity
 * increases add cards to the destination whichever direction built the diff.
 */

describe('describeSkippedChanges', () => {
  test('names the side that was left out, pluralized', () => {
    expect(describeSkippedChanges('additions', 3)).toBe(
      'Skipped 3 removals (applying additions only).',
    )
    expect(describeSkippedChanges('removals', 1)).toBe(
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
  test('rounds the wait up to whole seconds', () => {
    expect(describeRateLimitWait({ waitMs: 2000, retry: 1, maxRetries: 5 })).toBe(
      'Rate limited by Archidekt — waiting 2s before retry 1 of 5.',
    )
    expect(describeRateLimitWait({ waitMs: 2400, retry: 3, maxRetries: 5 })).toBe(
      'Rate limited by Archidekt — waiting 3s before retry 3 of 5.',
    )
  })

  test('a sub-second wait never reads as zero seconds', () => {
    expect(describeRateLimitWait({ waitMs: 200, retry: 5, maxRetries: 5 })).toContain('waiting 1s')
    expect(describeRateLimitWait({ waitMs: 0, retry: 1, maxRetries: 5 })).toContain('waiting 1s')
  })
})
