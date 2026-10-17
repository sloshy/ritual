import { describe, expect, test } from 'bun:test'
import { renderExport } from '../../src/export/output'
import { EXPORT_DIALECTS, EXPORT_PROPERTIES, type ExportProperty } from '../../src/export/render'
import { EXPORT_FORMATS, type ResolvedExportSettings } from '../../src/export/presets'
import type { ExportEntry } from '../../src/export/entries'
import type { ExportWarning } from '../../src/export/text'
import { CSV_HEADER } from '../../src/list/list-export'
import { buildCkCartCsv, type CkCartItem } from '../../src/buylist/cart-csv'
import {
  formatPrice,
  formatPriceInvariant,
  VALID_CURRENCIES,
} from '../../src/pricing/price-currency'
import {
  expectLocaleInForce,
  foreignLocales,
  pseudoCatalog,
  withSyntheticLocale,
  withSyntheticLocaleAsync,
} from '../helpers/sync-text'

/**
 * Exports are an interchange format, so every byte in one is a machine
 * contract: the CSV header row is what an importer column-matches on, a
 * decklist's board markers are what a site's importer reads, and a decimal
 * separator that follows the UI locale would put a `,` inside a comma-delimited
 * file and silently shift every column after it. Each pin runs against the full
 * `en-XA` pseudo-catalog (which changes every string routed through the
 * catalog) and real German (which changes everything routed through `Intl`).
 */

/** Every exportable column, so a future localized label cannot slip in unseen. */
const ALL_COLUMNS: ExportProperty[] = [...EXPORT_PROPERTIES]

/**
 * Entries that reach every branch a renderer has: a collection card carrying
 * every collection-side value, and a deck with a maybeboard and a token section
 * (which the `arena`/`moxfield` decklists drop and warn about), categories one
 * of which Moxfield cannot spell, a quantity past the bare-digit cap and a
 * foreign language.
 */
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
    categories: ['Ramp', 'Artifacts'],
    note: 'trade bait',
    // Grouping-sized, so a locale-aware number format would show in the cell
    // (the resolver keeps a preset value when the cache holds no printing).
    edhrecRank: 12345,
    fileOrder: 0,
  },
  {
    listType: 'deck',
    listName: 'Burn',
    section: 'Main',
    name: 'Fireblast',
    quantity: 1234,
    set: 'vis',
    collectorNumber: '78',
    finish: 'etched',
    condition: 'NM',
    language: 'de',
    categories: ['Burn', 'Board Wipes'],
    tags: ['Finisher'],
    fileOrder: 0,
  },
  {
    listType: 'deck',
    listName: 'Burn',
    section: 'Maybeboard',
    name: 'Price of Progress',
    quantity: 2,
    set: 'exo',
    collectorNumber: '96',
    fileOrder: 1,
  },
  {
    listType: 'deck',
    listName: 'Burn',
    section: 'Tokens',
    name: 'Goblin',
    quantity: 1,
    fileOrder: 2,
  },
]

/** One rendered export — its bytes and its (structured) warnings. */
type RenderedCase = {
  settings: ResolvedExportSettings
  content: string
  warnings: ExportWarning[]
}

/** Every format in every dialect it accepts, with and without the CSV toggles. */
async function renderEveryFormat(): Promise<RenderedCase[]> {
  const cases: RenderedCase[] = []
  for (const format of EXPORT_FORMATS) {
    for (const dialect of format === 'md' ? (['ritual'] as const) : EXPORT_DIALECTS) {
      for (const [header, quoteAll] of [
        [true, false],
        [false, true],
      ] as const) {
        const settings: ResolvedExportSettings = {
          format,
          columns: ALL_COLUMNS,
          header,
          quoteAll,
          dialect,
        }
        const rendered = await renderExport(ENTRIES, settings, {
          lookupPrintings: async () => [],
        })
        cases.push({ settings, ...rendered })
      }
    }
  }
  return cases
}

describe('every export format is locale-invariant', () => {
  /**
   * Neither foreign language reaches an export today; this pins that none ever
   * does. `expectLocaleInForce` proves each is really in force, its probes
   * moving in it.
   */
  test.each(foreignLocales())(
    'every format and dialect writes the same bytes under $tag',
    async ({ tag, catalog }) => {
      const english = await renderEveryFormat()
      // Vacuity guards: the cases reach the warnings, the dialect line forms, a
      // grouping-sized number, and the CSV header row — spelled out, since a
      // silent empty diff would pass the equality below if both sides broke
      // the same way.
      expect(english.some((rendered) => rendered.warnings.length > 0)).toBe(true)
      expect(english.some((rendered) => rendered.content.includes('1234x Fireblast'))).toBe(true)
      expect(english.some((rendered) => rendered.content.includes('12345'))).toBe(true)
      const csv = english.find(
        ({ settings }) =>
          settings.format === 'csv' && settings.dialect === 'ritual' && settings.header,
      )
      expect(csv?.content.split('\n')[0]).toBe(
        'Name,Quantity,Set,Collector Number,Edition,Scryfall ID,EDHREC Rank,Finish,Is Foil,Condition,Language,Labels,Tags,Categories,Primary Category,Note,Section,List,List Type',
      )

      const foreign = await withSyntheticLocaleAsync(tag, catalog, async (locale) => {
        expectLocaleInForce(locale)
        const rendered = await renderEveryFormat()
        expectLocaleInForce(locale)
        return rendered
      })
      expect(foreign).toEqual(english)
    },
  )
})

describe('the other CSV writers are locale-invariant', () => {
  test('the fixed-column CSV header is the same string in every locale', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      expect(CSV_HEADER).toBe('Name,Set,Collector Number,Finish,Condition,Language,Quantity')
    })
  })

  test.each(foreignLocales())(
    "the Card Kingdom cart CSV keeps the buyer's own vocabulary under $tag",
    ({ tag, catalog }) => {
      const items: CkCartItem[] = [
        { name: "Mishra's Factory", edition: 'Antiquities', finish: 'nonfoil', quantity: 2 },
        // Etched exports as foil, and its warning is a code — no sentence to localize.
        { name: 'Sol Ring', edition: 'Commander Legends', finish: 'etched', quantity: 1 },
      ]
      withSyntheticLocale(tag, catalog, (locale) => {
        expectLocaleInForce(locale)
        expect(buildCkCartCsv(items)).toEqual({
          csv: "Mishra's Factory,Antiquities,false,2\nSol Ring,Commander Legends,true,1\n",
          titleCount: 2,
          cardCount: 3,
          warnings: [{ code: 'etched-as-foil', params: { titles: ['Sol Ring'] } }],
        })
        expectLocaleInForce(locale)
      })
    },
  )
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
    withSyntheticLocale('de-DE', {}, () => {
      for (const currency of VALID_CURRENCIES) {
        const cell = formatPriceInvariant(1234.5, currency)
        expect(cell).not.toContain(',')
        expect(cell).toContain('.')
      }
    })
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
    expect(formatPrice(1234.5, 'usd')).toBe('$1,234.50')
    expect(formatPriceInvariant(1234.5, 'usd')).toBe('$1234.50')

    withSyntheticLocale('de-DE', {}, () => {
      // A comma decimal separator — the exact byte that would shift every column
      // after it in a CSV row.
      expect(formatPrice(1234.5, 'usd')).not.toBe(formatPriceInvariant(1234.5, 'usd'))
      expect(formatPriceInvariant(1234.5, 'usd')).toBe('$1234.50')
    })
  })
})
