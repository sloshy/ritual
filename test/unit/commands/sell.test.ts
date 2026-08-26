import { describe, expect, test } from 'bun:test'
import {
  formatBuyingEntryLine,
  formatSellHeaderLines,
  formatSellListTitle,
  formatSellTotalsLine,
  formatUnsoldEntryLine,
  renderSellReportText,
  sellDisclaimer,
} from '../../../src/commands/sell'
import { csvScriptingOptions } from '../../../src/commands/scripting'
import type {
  BuyingSellEntry,
  SellListSummary,
  SellReportEntry,
  SellReportTotals,
} from '../../../src/pricing/sell-report'

function entry(overrides: Partial<Omit<BuyingSellEntry, 'status'>> = {}): BuyingSellEntry {
  return {
    listType: 'collection',
    listName: 'Binder',
    section: 'Main',
    name: 'Arahbo',
    quantity: 1,
    set: 'fdn',
    collectorNumber: '294',
    finish: 'nonfoil',
    pinned: true,
    status: 'buying',
    matchVia: 'scryfall-id',
    ckProductId: 10,
    ckSku: 'FDN-0294',
    ckName: 'Arahbo',
    ckEdition: 'Foundations Variants',
    ckVariation: '0294 - Borderless',
    ckFinish: 'nonfoil',
    priceBuy: 1.5,
    priceRetail: 3.49,
    qtyBuying: 25,
    sellableQuantity: 1,
    value: 1.5,
    fileOrder: 0,
    ...overrides,
  }
}

const summary: SellListSummary = {
  type: 'collection',
  name: 'Binder',
  cardCount: 5,
  sellableCount: 2,
  totalValue: 3,
  notBuyingCount: 2,
  noMatchCount: 1,
}

const totals: SellReportTotals = {
  cardCount: 5,
  sellableCount: 2,
  totalValue: 3,
  notBuyingCount: 2,
  noMatchCount: 1,
  listCount: 1,
}

describe('sell text formatting', () => {
  test('a buying line carries price, quantities, printing, and the CK product', () => {
    expect(formatBuyingEntryLine(entry())).toBe(
      '$1.50 ×1  Arahbo (FDN:294) · Foundations Variants (0294 - Borderless) · max 25',
    )
  })

  test('a capped line shows how many of the owned copies CK takes', () => {
    const line = formatBuyingEntryLine(
      entry({
        quantity: 5,
        sellableQuantity: 2,
        value: 3,
        finish: 'foil',
        ckFinish: 'foil',
        condition: 'LP',
      }),
    )
    expect(line).toBe(
      '$1.50 ×2 of 5 = $3.00  Arahbo (FDN:294) [foil] [LP] · Foundations Variants (0294 - Borderless) · max 25',
    )
  })

  test('an unpinned foil quote shows the finish on the CK product segment', () => {
    const line = formatBuyingEntryLine(
      entry({ finish: undefined, ckFinish: 'foil', pinned: false }),
    )
    expect(line).toContain('· Foundations Variants (0294 - Borderless) [foil] ·')
  })

  test('unsold lines say why', () => {
    const paused: SellReportEntry = { ...entry(), status: 'not-buying' }
    expect(formatUnsoldEntryLine(paused)).toBe(
      'Arahbo (FDN:294) ×1 — not buying (Foundations Variants (0294 - Borderless))',
    )
    const unmatched: SellReportEntry = {
      listType: 'collection',
      listName: 'Binder',
      section: 'Main',
      name: 'Arahbo',
      quantity: 1,
      set: 'fdn',
      collectorNumber: '294',
      pinned: true,
      status: 'no-match',
      noMatchReason: 'printing-not-found',
      sellableQuantity: 0,
      value: 0,
      fileOrder: 0,
    }
    expect(formatUnsoldEntryLine(unmatched)).toBe(
      'Arahbo (FDN:294) ×1 — no match (printing-not-found)',
    )
  })

  test('list titles and totals summarize the counts', () => {
    expect(formatSellListTitle(summary)).toBe(
      '[collection] Binder — CK buys 2 of 5 cards · $3.00 (3 not bought)',
    )
    expect(formatSellTotalsLine(totals)).toBe('Total: $3.00 for 2 of 5 cards across 1 list')
    expect(formatSellTotalsLine({ ...totals, listCount: 2 })).toContain('across 2 lists')
  })

  test('header lines carry the feed stamp and age, skipping an empty stamp', () => {
    const lines = formatSellHeaderLines(
      { feedCreatedAt: '2026-08-04 06:06:09', feedRetrievedAt: 0 },
      3 * 60 * 60 * 1000,
    )
    expect(lines).toEqual([
      'Card Kingdom buylist · generated 2026-08-04 06:06:09 · retrieved 3 hours ago',
    ])
    expect(formatSellHeaderLines({ feedCreatedAt: '', feedRetrievedAt: 0 }, 60_000)[0]).toBe(
      'Card Kingdom buylist · retrieved 1 minute ago',
    )
  })

  test('--all itemizes skipped entries without touching the disclaimer', () => {
    const entries: SellReportEntry[] = [
      entry(),
      { ...entry({ name: 'Paused', sellableQuantity: 0, value: 0 }), status: 'not-buying' },
    ]
    const view = { lists: [summary], entries, totals }

    const brief = renderSellReportText(view, { header: ['header'], all: false, quiet: false })
    expect(brief.startsWith('header')).toBe(true)
    expect(brief).toContain('rerun with --all')
    expect(brief).not.toContain('Paused')
    expect(brief).toContain(sellDisclaimer())

    const verbose = renderSellReportText(view, { header: ['header'], all: true, quiet: false })
    expect(verbose).toContain('Paused')
    expect(verbose).not.toContain('rerun with --all')
    expect(verbose).toContain(sellDisclaimer())
  })

  test('--quiet drops only the disclaimer', () => {
    const view = { lists: [summary], entries: [entry()], totals }
    const quiet = renderSellReportText(view, { header: [], all: false, quiet: true })
    expect(quiet).not.toContain(sellDisclaimer())
    expect(quiet).toContain('CK buys 2 of 5 cards')
  })
})

describe('csvScriptingOptions', () => {
  test('csv and absent formats borrow the text error dialect; the rest pass through', () => {
    expect(csvScriptingOptions('csv', false)).toEqual({ output: 'text', quiet: false })
    expect(csvScriptingOptions(undefined, false)).toEqual({ output: 'text', quiet: false })
    expect(csvScriptingOptions('json', true)).toEqual({ output: 'json', quiet: true })
    expect(csvScriptingOptions('ndjson', false)).toEqual({ output: 'ndjson', quiet: false })
    expect(csvScriptingOptions('text', false)).toEqual({ output: 'text', quiet: false })
  })
})
