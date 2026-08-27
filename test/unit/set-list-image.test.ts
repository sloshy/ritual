import { describe, expect, test } from 'bun:test'
import {
  listImageCardRows,
  listImageModeChoices,
  type ListImageModeChoice,
} from '../../src/commands/set-list-image'
import type { EntryRef } from '../../src/list/entry-ref'

/**
 * The pure halves of `ritual set-list-image`'s wizard: which modes the menu
 * offers (and which one it marks as current), and how the list's own cards read
 * in the card picker. The flag handling, the writes and the refusals are
 * side-effecting and are pinned by test/integration/set-list-image-cli.test.ts.
 */

function values(choices: readonly ListImageModeChoice[]): string[] {
  return choices.map((choice) => choice.value)
}

describe('cover-image mode menu', () => {
  test('offers all four modes in a fixed order, whatever is set now', () => {
    expect(values(listImageModeChoices(null))).toEqual(['default', 'card', 'file', 'url'])
    expect(values(listImageModeChoices({ card: 3 }))).toEqual(['default', 'card', 'file', 'url'])
  })

  test('marks exactly the mode the list uses now', () => {
    const marked = (current: Parameters<typeof listImageModeChoices>[0]): string[] =>
      listImageModeChoices(current)
        .filter((choice) => choice.title.endsWith('✓'))
        .map((choice) => choice.value)

    expect(marked(null)).toEqual(['default'])
    expect(marked({ card: 12 })).toEqual(['card'])
    expect(marked({ file: 'alters/atraxa.png' })).toEqual(['file'])
    expect(marked({ url: 'https://example.test/cover.jpg' })).toEqual(['url'])
  })
})

describe('cover-image card picker rows', () => {
  const entries: EntryRef[] = [
    { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 4 },
    // No id: the row could not be written as `image: {card: N}` at all.
    { name: 'Arcane Signet' },
    { name: 'Atraxa, Praetors’ Voice', set: 'cmr', collectorNumber: '3', cardId: 1 },
  ]

  test('keeps file order and drops lines with no id', () => {
    expect(listImageCardRows(entries).map((row) => row.cardId)).toEqual([4, 1])
  })

  test('titles a row with its printing uppercased and its id', () => {
    expect(listImageCardRows(entries)[0]?.title).toBe('Sol Ring (C21:263) &4')
  })

  test('a list with no card lines offers no rows', () => {
    expect(listImageCardRows([])).toEqual([])
  })
})
