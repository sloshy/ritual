import { describe, expect, test } from 'bun:test'
import { formatPrunedCategoriesSuffix, saveSuccessSuffix } from '../../../src/editor/save-notices'

describe('formatPrunedCategoriesSuffix', () => {
  test('is empty when the save pruned nothing', () => {
    expect(formatPrunedCategoriesSuffix([])).toBe('')
  })

  test('renders the singular for one name, always leading with a space', () => {
    const suffix = formatPrunedCategoriesSuffix(['Sol Ring'])
    expect(suffix.startsWith(' ')).toBe(true)
    expect(suffix).toContain('a card')
    expect(suffix).toContain('Sol Ring')
  })

  // The caller must pass `count` as well as `items`: `t()` throws in strict mode
  // when the numeric plural parameter is missing, which no compiler catches.
  test('renders the plural for two, listing both names', () => {
    const suffix = formatPrunedCategoriesSuffix(['Sol Ring', 'Rhystic Study'])
    expect(suffix).toContain('cards')
    expect(suffix).toContain('Sol Ring, Rhystic Study')
  })
})

describe('saveSuccessSuffix', () => {
  test('is empty for a save with nothing to report', () => {
    expect(saveSuccessSuffix({})).toBe('')
  })

  test('joins dropped notes, pruned categories and server warnings in that order', () => {
    const suffix = saveSuccessSuffix({
      droppedNotes: [{ cardName: 'Sol Ring', note: 'from trade' }],
      prunedCategories: ['Rhystic Study'],
      categoryWarnings: ['Categories sidecar could not be read: bad JSON'],
    })
    expect(suffix.indexOf('from trade')).toBeLessThan(suffix.indexOf('Rhystic Study'))
    expect(suffix.indexOf('Rhystic Study')).toBeLessThan(suffix.indexOf('bad JSON'))
    expect(suffix.startsWith(' ')).toBe(true)
  })

  test('a warning alone still leads with a space, so it joins the status sentence', () => {
    expect(saveSuccessSuffix({ categoryWarnings: ['Trouble.'] })).toBe(' Trouble.')
  })
})
