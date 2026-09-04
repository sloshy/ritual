import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { renderExport } from '../../src/export/output'
import { EXPORT_PROPERTIES, type ExportProperty } from '../../src/export/render'
import type { ExportEntry } from '../../src/export/entries'
import { CSV_HEADER } from '../../src/list/list-export'
import { buildCkCartCsv } from '../../src/buylist/cart-csv'
import {
  formatPrice,
  formatPriceInvariant,
  VALID_CURRENCIES,
} from '../../src/pricing/price-currency'
import { en } from '../../src/i18n/messages/en'
import { enMeta } from '../../src/i18n/messages/en.meta'
import { loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import { PSEUDO_LOCALE, pseudoLocalize } from '../../scripts/generate-locales'
import { localeTag } from '../../src/i18n/locale-tag'

/**
 * CSV is an interchange format, so every cell in it is a machine contract: the
 * header row is what an importer column-matches on, and a decimal separator
 * that follows the UI locale would put a `,` inside a comma-delimited file and
 * silently shift every column after it. Both properties are asserted here
 * against the generated `en-XA` pseudo-locale (which changes every string that
 * *is* routed through the catalog) and against hostile explicit locales.
 */

const pseudoCatalog = pseudoLocalize(en, enMeta)

/** Every exportable column, so a future localized label cannot slip in unseen. */
const ALL_COLUMNS: ExportProperty[] = [...EXPORT_PROPERTIES]

const ENTRIES: ExportEntry[] = [
  {
    listType: 'collection',
    listName: 'Binder',
    section: 'Main',
    name: 'Lightning Bolt',
    quantity: 3,
    set: 'lea',
    collectorNumber: '161',
    finish: 'foil',
    condition: 'LP',
    language: 'ja',
    labels: ['sale'],
    // Non-empty so the fence covers the two new columns' *cells* (the join and
    // the primary) and not only their header labels.
    categories: ['Ramp', 'Artifacts'],
    note: 'trade bait',
    fileOrder: 0,
  },
]

async function renderCsv(): Promise<string> {
  const { content } = await renderExport(
    ENTRIES,
    {
      format: 'csv',
      columns: ALL_COLUMNS,
      header: true,
      quoteAll: false,
      dialect: 'ritual',
    },
    { lookupPrintings: async () => [] },
  )
  return content
}

afterEach(() => {
  resetI18nRuntime()
})

describe('CSV exports are locale-invariant', () => {
  test('headers and cells are identical under en and en-XA', async () => {
    setLocale(localeTag('en'))
    const english = await renderCsv()

    loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
    setLocale(PSEUDO_LOCALE)
    const pseudo = await renderCsv()

    expect(pseudo).toBe(english)
    // Spot-check the header explicitly: a silent empty diff would pass the
    // equality above if both sides broke the same way.
    expect(english.split('\n')[0]).toBe(
      'Name,Quantity,Set,Collector Number,Edition,Scryfall ID,Finish,Is Foil,Condition,Language,Labels,Tags,Categories,Primary Category,Note,Section,List,List Type',
    )
  })

  test('the fixed-column CSV header is the same string in every locale', () => {
    loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
    setLocale(localeTag('en'))
    const english = CSV_HEADER
    setLocale(PSEUDO_LOCALE)
    expect(CSV_HEADER).toBe(english)
    expect(CSV_HEADER).toBe('Name,Set,Collector Number,Finish,Condition,Language,Quantity')
  })

  test("the Card Kingdom cart CSV keeps the buyer's own vocabulary", () => {
    loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
    const items = [
      { name: "Mishra's Factory", edition: 'Antiquities', finish: 'nonfoil' as const, quantity: 2 },
    ]
    setLocale(localeTag('en'))
    const english = buildCkCartCsv(items).csv
    setLocale(PSEUDO_LOCALE)
    expect(buildCkCartCsv(items).csv).toBe(english)
    expect(english).toBe("Mishra's Factory,Antiquities,false,2\n")
  })
})

describe('formatPriceInvariant', () => {
  /**
   * The one property that makes this function worth existing separately from
   * `formatPrice`: a comma decimal separator inside a comma-delimited file is
   * unrepresentable. `Intl.NumberFormat('de-DE')` would render `1234,50`.
   */
  // The function is locale-blind by construction (`amount.toFixed(2)`), so one
  // representative non-English locale is the whole regression fence; the
  // divergence case below is what actually documents why it exists.
  test('never emits a comma, whatever the UI locale', () => {
    setLocale(localeTag('de-DE'))
    for (const currency of VALID_CURRENCIES) {
      const cell = formatPriceInvariant(1234.5, currency)
      expect(cell).not.toContain(',')
      expect(cell).toContain('.')
    }
  })

  test('renders exactly two decimals with a dot separator per currency', () => {
    expect(formatPriceInvariant(1234.5, 'usd')).toBe('$1234.50')
    expect(formatPriceInvariant(4, 'eur')).toBe('€4.00')
    expect(formatPriceInvariant(1.25, 'tix')).toBe('1.25 tix')
  })

  // Why the two functions cannot be one: `formatPrice` is fully locale-aware, so
  // it groups thousands and follows the locale's decimal separator. Both are
  // correct for a price *label* and both are unrepresentable in a delimited file.
  test('display formatting genuinely diverges from it', () => {
    setLocale(localeTag('en'))
    expect(formatPrice(1234.5, 'usd')).toBe('$1,234.50')
    expect(formatPriceInvariant(1234.5, 'usd')).toBe('$1234.50')

    setLocale(localeTag('de-DE'))
    // A comma decimal separator — the exact byte that would shift every column
    // after it in a CSV row.
    expect(formatPrice(1234.5, 'usd')).not.toBe(formatPriceInvariant(1234.5, 'usd'))
    expect(formatPriceInvariant(1234.5, 'usd')).toBe('$1234.50')
  })
})

describe('export files on disk', () => {
  test('a CSV written under the pseudo-locale is byte-identical to the English one', async () => {
    const dir = path.join(tmpdir(), `ritual-export-locale-${crypto.randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    try {
      setLocale(localeTag('en'))
      const englishPath = path.join(dir, 'english.csv')
      await fs.writeFile(englishPath, `${await renderCsv()}\n`)

      loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
      setLocale(PSEUDO_LOCALE)
      const pseudoPath = path.join(dir, 'pseudo.csv')
      await fs.writeFile(pseudoPath, `${await renderCsv()}\n`)

      expect(await fs.readFile(pseudoPath)).toEqual(await fs.readFile(englishPath))
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
