import { describe, expect, test } from 'bun:test'
import { formatQuantityToken, readQuantityToken } from '../../src/card/card-line-quantity'
import { plainTextCardLine } from '../../src/card/card-line'
import { deckToExportText, deckToMarkdown } from '../../src/list/deck-text'
import { collectionToText } from '../../src/list/list-export'
import { selectionToText } from '../../src/list-view/selection-export'
import { renderTextExport, EXPORT_DIALECTS, type ExportDialect } from '../../src/export/render'
import type { ExportEntry } from '../../src/export/entries'
import { parseDeckText } from '../../src/importers/text-file'
import type { DeckData } from '../../src/list/deck'
import { parsedCardLine } from '../helpers/card-line'
import { makeCollectionEntry, makeSelectedCard } from '../test-utils'

/**
 * The quantity token's two halves must agree: every quantity a writer emits,
 * the reader takes back as that quantity — never as the start of the card's
 * name. A bare run of four or more digits reads as a name
 * (`1996 World Champion`), so the writers mark such a quantity with `x`.
 *
 * The canonical deck line's round trip at these quantities is in the round-trip
 * table of `card-line-tail.test.ts`; the reader's refusals and advisories are in
 * `card-line-grammar.test.ts`.
 */

describe('readQuantityToken', () => {
  test.each([
    ['4 Sol Ring', { value: 4, text: '4', length: 2 }],
    ['999 Sol Ring', { value: 999, text: '999', length: 4 }],
    ['1234x Sol Ring', { value: 1234, text: '1234x', length: 6 }],
    ['10X  Sol Ring', { value: 10, text: '10X', length: 5 }],
  ])('reads the quantity %j starts with', (text, token) => {
    expect(readQuantityToken(text)).toEqual(token)
  })

  test.each(['1000 Sol Ring', '1996 World Champion', '4Sol Ring', 'Sol Ring'])(
    '%j starts with no quantity',
    (text) => {
      expect(readQuantityToken(text)).toBeUndefined()
    },
  )
})

describe('formatQuantityToken', () => {
  test.each([
    [1, '1'],
    [999, '999'],
    [1000, '1000x'],
    [1234, '1234x'],
    [1_000_000, '1000000x'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991x'],
  ])('writes %d as %j', (quantity, token) => {
    expect(formatQuantityToken(quantity)).toBe(token)
  })
})

describe('deck card line', () => {
  // Pins that `parseDeckText`'s card-line candidate test accepts an x-marked
  // run of four or more digits, as well as the grammar does.
  test.each([
    [999, '999'],
    [1000, '1000x'],
    [1234, '1234x'],
    [1_000_000, '1000000x'],
  ])(
    '%d copies survive a deck markdown reload and re-write byte-identically',
    (quantity, token) => {
      const file = `# Lands\n\n## Main\n- ${token} Island (LEA:288) &1\n`
      const read = parseDeckText(file, 'Lands')
      expect(read.warnings).toEqual([])
      expect(read.deck.sections[0]?.cards[0]).toMatchObject({ quantity, name: 'Island' })
      expect(deckToMarkdown(read.deck)).toBe(file)
    },
  )
})

describe('plain-text card line', () => {
  test.each([
    [999, '999 Sol Ring (C21:263)'],
    [1234, '1234x Sol Ring (C21:263)'],
  ])('writes %d copies as %j', (quantity, line) => {
    expect(
      plainTextCardLine(quantity, { name: 'Sol Ring', set: 'c21', collectorNumber: '263' }),
    ).toBe(line)
  })

  test.each([999, 1000, 1234, 1_000_000])('%d copies read back as written', (quantity) => {
    const line = plainTextCardLine(quantity, {
      name: 'Sol Ring',
      set: 'c21',
      collectorNumber: '263',
    })
    expect(parsedCardLine('deck', line)).toEqual({
      quantity,
      name: 'Sol Ring',
      printing: { set: 'c21', collectorNumber: '263' },
    })
  })
})

/**
 * Every writer of a line Ritual's importer reads back, at 1,000 copies of one
 * card. A new text writer belongs in this table: a quantity it writes bare
 * reads back as one copy of "1000 Island".
 */
describe('every text writer reads back 1,000 copies', () => {
  const ISLAND = { name: 'Island', set: 'lea', collectorNumber: '288' } as const

  const exportEntry: ExportEntry = {
    ...ISLAND,
    listType: 'deck',
    listName: 'Lands',
    section: 'Main',
    quantity: 1000,
    fileOrder: 0,
  }

  /** A deck holding 1,000 Islands, read the way the site and the CLI read one. */
  function landsDeck(): DeckData {
    return parseDeckText('# Lands\n\n## Main\n- 1000x Island (LEA:288) &1\n', 'Lands').deck
  }

  const writers: readonly [string, () => string][] = [
    ...EXPORT_DIALECTS.map((dialect: ExportDialect): [string, () => string] => [
      `renderTextExport (${dialect})`,
      () => renderTextExport([exportEntry], dialect).content,
    ]),
    [
      'collectionToText',
      () => collectionToText(Array.from({ length: 1000 }, () => makeCollectionEntry(ISLAND))),
    ],
    ['selectionToText', () => selectionToText([makeSelectedCard({ ...ISLAND, quantity: 1000 })])],
    ['deckToExportText', () => deckToExportText(landsDeck())],
  ]

  test.each(writers)('%s', (_writer, write) => {
    // The dialects put a bare board marker (`Deck`) above the card line.
    const cardLines = write()
      .split('\n')
      .filter((line) => line.includes('Island'))
    expect(cardLines).toHaveLength(1)
    expect(parsedCardLine('deck', cardLines[0]!)).toMatchObject({ quantity: 1000, name: 'Island' })
  })
})
