import { describe, expect, test } from 'bun:test'
import { removeCategoryFromRecord } from '../../src/list/card-categories-sidecar'
import { diffCardCategories } from '../../src/changes/diff-categories'
import { categoriesRecord } from '../helpers/card-categories'

/**
 * `ritual categories remove` has no change action of its own: design §5 says a
 * removal is the affected cards' `set-categories` plus a `set-category-order`
 * without the name. The record surgery itself lives with the rest of the sidecar
 * engine (`card-categories-sidecar.test.ts`); what is pinned here is the event
 * decomposition the command derives from it.
 */

describe('remove events', () => {
  test('decompose into one order event plus one set-categories per affected card', () => {
    const record = categoriesRecord(['Ramp', 'Draw'], {
      'Sol Ring': ['Ramp', 'Draw'],
      'Rhystic Study': ['Draw'],
      Ponder: ['Ramp'],
    })
    const events = diffCardCategories(record, removeCategoryFromRecord(record, 'Draw'))

    expect(events.filter((e) => e.action === 'set-category-order')).toMatchObject([
      { action: 'set-category-order', order: ['Ramp'] },
    ])
    const perCard = events.filter((e) => e.action === 'set-categories')
    // Survivors first (canonical name order), then the cards `after` no longer
    // holds — which are the clears.
    expect(perCard.map((e) => e.cardName)).toEqual(['Sol Ring', 'Rhystic Study'])
    // Rhystic Study loses its only category, so its event is the clear.
    expect(perCard.map((e) => e.categories)).toEqual([['Ramp'], []])
    // Ponder never carried the removed name, so nothing is recorded for it.
    expect(events.some((e) => e.action === 'set-categories' && e.cardName === 'Ponder')).toBe(false)
  })
})
