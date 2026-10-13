import { describe, expect, test } from 'bun:test'
import { DEFAULT_LOCALE } from '../../../src/i18n/runtime'
import { tDynamic, type RenderParams } from '../../../src/i18n/t'
import type { MessageKey } from '../../../src/i18n/messages/en'

/**
 * The import messages that count something, in both English forms. The
 * integration suites run without strict i18n, so a placeholder left literal
 * (`{cards}`) or a `$plural` missing a form would slip through them; these pin
 * the exact English of each form, singular and plural.
 */

/** One rendering to pin: the key, what it interpolates, and the English it must read. */
type Wording = [key: MessageKey, params: RenderParams, english: string]

const WORDINGS: Wording[] = [
  ['cli.import.rowsFailed', { count: 1 }, '1 row failed to import:'],
  ['cli.import.rowsFailed', { count: 3 }, '3 rows failed to import:'],
  ['cli.import.linesNotImported', { count: 1 }, '1 line could not be imported:'],
  ['cli.import.linesNotImported', { count: 2 }, '2 lines could not be imported:'],
  ['cli.import.linesWithoutLabels', { count: 1 }, '1 line was imported without its labels:'],
  ['cli.import.linesWithoutLabels', { count: 2 }, '2 lines were imported without their labels:'],
  [
    'cli.import.collectionNeedsPrinting',
    { count: 1, names: 'Sol Ring', more: '' },
    'Cannot import as a collection: 1 card line has no printing (set and collector number required): Sol Ring',
  ],
  [
    'cli.import.collectionNeedsPrinting',
    { count: 2, names: 'Sol Ring, Mox Ruby', more: '' },
    'Cannot import as a collection: 2 card lines have no printing (set and collector number required): Sol Ring, Mox Ruby',
  ],
  [
    'domain.import.categoriesForMissingCards',
    { count: 1, names: 'Sol Ring' },
    'Categories are recorded for a card the list does not hold: Sol Ring',
  ],
  [
    'domain.import.categoriesForMissingCards',
    { count: 2, names: 'Sol Ring, Mox Ruby' },
    'Categories are recorded for cards the list does not hold: Sol Ring, Mox Ruby',
  ],
  [
    'domain.import.categoriesPruned',
    { count: 1, names: 'Sol Ring' },
    'Dropped categories for a card no longer in the list: Sol Ring',
  ],
  [
    'domain.import.categoriesPruned',
    { count: 2, names: 'Sol Ring, Mox Ruby' },
    'Dropped categories for cards no longer in the list: Sol Ring, Mox Ruby',
  ],
  [
    'domain.import.archidektUnnamedEntries',
    { deckId: '42', count: 1 },
    'Archidekt deck 42: skipped 1 card entry with no card name.',
  ],
  [
    'domain.import.archidektUnnamedEntries',
    { deckId: '42', count: 3 },
    'Archidekt deck 42: skipped 3 card entries with no card name.',
  ],
  [
    'domain.import.csv.columnMissing',
    { column: 2, field: 'set', count: 1 },
    "Column 2 (mapped to 'set') does not exist: the file has 1 column",
  ],
  [
    'domain.import.csv.columnMissing',
    { column: 9, field: 'set', count: 6 },
    "Column 9 (mapped to 'set') does not exist: the file has 6 columns",
  ],
]

describe('import wording', () => {
  test.each(WORDINGS)('%s %o reads in English as written', (key, params, english) => {
    expect(tDynamic(DEFAULT_LOCALE, key, params)).toBe(english)
  })
})
