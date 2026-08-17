import { describe, test, expect } from 'bun:test'
import { combinedLabelFilters } from '../../../src/site/CombinedCardsView'

// Only the view's pure chip derivation is exercised here: solid-js resolves to
// its server build under `bun test`, so the rendered toolbar is Playwright's.
describe('combinedLabelFilters', () => {
  test('offers the union of the selected kinds’ labels, in canonical order', () => {
    expect(combinedLabelFilters(['deck', 'collection'])).toEqual([
      'sale',
      'trade',
      'keep',
      'proxy',
      'none',
    ])
  })

  test('a deck-only selection offers proxy and the unlabeled chip', () => {
    expect(combinedLabelFilters(['deck', 'deck'])).toEqual(['proxy', 'none'])
  })

  test('a selection whose kinds carry no labels offers no chips, which hides the row', () => {
    expect(combinedLabelFilters(['wanted'])).toEqual([])
    expect(combinedLabelFilters([])).toEqual([])
  })
})
