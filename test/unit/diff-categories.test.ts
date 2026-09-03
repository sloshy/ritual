import { describe, expect, test } from 'bun:test'
import { diffCardCategories } from '../../src/changes/diff-categories'
import { emptyCardCategoriesRecord } from '../../src/list/card-categories-sidecar'
import type { ChangeEvent } from '../../src/changes/change-event'

import { categoriesRecord as record } from '../helpers/card-categories'

/** Each event as `action:subject` — enough to pin what a diff recorded. */
function summarize(events: ChangeEvent[]): string[] {
  return events.map((event) => {
    if (event.action === 'set-categories') {
      return `set-categories:${event.cardName}:${event.categories.join('|')}`
    }
    if (event.action === 'set-category-order') return `set-category-order:${event.order.join('|')}`
    return event.action
  })
}

describe('diffCardCategories', () => {
  test('no difference means no events', () => {
    const before = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    const after = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    expect(diffCardCategories(before, after)).toEqual([])
  })

  test('an added card is one set-categories', () => {
    const before = record(['Ramp'], {})
    const after = record(['Ramp'], { 'Sol Ring': ['Ramp'] })
    expect(summarize(diffCardCategories(before, after))).toEqual(['set-categories:Sol Ring:Ramp'])
  })

  test('a changed list is one set-categories carrying the new list', () => {
    const before = record([], { 'Sol Ring': ['Ramp'] })
    const after = record([], { 'Sol Ring': ['Ramp', 'Artifacts'] })
    expect(summarize(diffCardCategories(before, after))).toEqual([
      'set-categories:Sol Ring:Ramp|Artifacts',
    ])
  })

  test('a card that lost its entry is a clear', () => {
    const before = record([], { 'Sol Ring': ['Ramp'] })
    expect(summarize(diffCardCategories(before, emptyCardCategoriesRecord()))).toEqual([
      'set-categories:Sol Ring:',
    ])
  })

  test('a reordered card is a change — the first entry is the primary', () => {
    const before = record([], { 'Sol Ring': ['Ramp', 'Artifacts'] })
    const after = record([], { 'Sol Ring': ['Artifacts', 'Ramp'] })
    expect(summarize(diffCardCategories(before, after))).toEqual([
      'set-categories:Sol Ring:Artifacts|Ramp',
    ])
  })

  test('an order-only change is one set-category-order and nothing else', () => {
    const before = record(['Ramp', 'Draw'], { 'Sol Ring': ['Ramp'] })
    const after = record(['Draw', 'Ramp'], { 'Sol Ring': ['Ramp'] })
    expect(summarize(diffCardCategories(before, after))).toEqual(['set-category-order:Draw|Ramp'])
  })

  test('the order event comes first, then the cards in data name order', () => {
    const before = record(['Ramp'], {})
    const after = record(['Draw', 'Ramp'], { 'Sol Ring': ['Ramp'], Brainstorm: ['Draw'] })
    expect(summarize(diffCardCategories(before, after))).toEqual([
      'set-category-order:Draw|Ramp',
      'set-categories:Brainstorm:Draw',
      'set-categories:Sol Ring:Ramp',
    ])
  })
})
