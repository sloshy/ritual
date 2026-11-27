import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import {
  checkListsSummaryOptions,
  groupRowsByType,
  isListsSummaryRefusal,
  summaryPricing,
  parseListsSummaryOptions,
  summarizeLists,
  type ListsSummary,
  type ListsSummaryOptions,
  type ListsSummaryRow,
} from '../../src/summary/lists'
import { loadAndBuildPriceReport } from '../../src/pricing/price-runtime'
import { listLocations } from '../../src/list/resolve-list'
import { syncMessage } from '../../src/sync/message'
import { sumPricedEntries } from '../../src/pricing/price-report'
import { ExitCode, localizedCommandError } from '../../src/util/errors'
import {
  bindWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type BoundWorkspace,
} from '../helpers/workspace'
import { makeScryfallCard } from '../test-utils'

/**
 * The cross-list summary engine against synthetic workspaces. Counting and
 * selection are the engine's own job and are pinned here; pricing is the price
 * engine's, so the value cases pin what the summary adds — section narrowing,
 * the identity join, totals — and that a row matches single-list pricing.
 */

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
})

afterEach(async () => {
  await ws.dispose()
})

/**
 * The standard workspace. Names are chosen so name order agrees with neither
 * slug order nor type order:
 *
 * - deck `burn` "Burn" (modern, proxy default): Main 4 Bolt + 2 Guide,
 *   Sideboard 3 Smash, Maybeboard 1 Bolt;
 * - deck `elves` "Elf Ball" (legacy): Main 1 Llanowar Elves;
 * - collection `binder` "Trade Binder" (trade default): Bolt (Main) + Sol Ring (Artifacts);
 * - collection `empty` "Attic Box": no lines;
 * - wanted `wants` "Aardvark Wants": Sol Ring + Mox Pearl.
 */
async function writeStandardLists(): Promise<void> {
  await writeDeckFile(ws.dir, 'burn', {
    name: 'Burn',
    frontMatter: { format: 'modern', labels: ['proxy'], description: 'Fast and red' },
    sections: [
      {
        name: 'Main',
        cards: [
          { name: 'Lightning Bolt', quantity: 4 },
          { name: 'Goblin Guide', quantity: 2 },
        ],
      },
      { name: 'Sideboard', cards: [{ name: 'Smash to Smithereens', quantity: 3 }] },
      { name: 'Maybeboard', cards: [{ name: 'Lightning Bolt', quantity: 1 }] },
    ],
  })
  await writeDeckFile(ws.dir, 'elves', {
    name: 'Elf Ball',
    frontMatter: { format: 'legacy' },
    cards: [{ name: 'Llanowar Elves', quantity: 1 }],
  })
  await writeCollectionFile(ws.dir, 'binder', {
    title: 'Trade Binder',
    labels: ['trade'],
    entries: [
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270', section: 'Artifacts' },
    ],
  })
  await writeCollectionFile(ws.dir, 'empty', { title: 'Attic Box', entries: [] })
  await writeWantedFile(ws.dir, 'wants', {
    title: 'Aardvark Wants',
    entries: [{ name: 'Sol Ring' }, { name: 'Mox Pearl' }],
  })
}

/** Bolt at LEA:161 for $3 and Sol Ring at LEA:270 for $5. */
async function seedPrices(): Promise<void> {
  await cardCache.bulkSet({
    'Lightning Bolt': [
      makeScryfallCard({
        name: 'Lightning Bolt',
        set: 'lea',
        collector_number: '161',
        prices: { usd: '3.00' },
      }),
    ],
    'Sol Ring': [
      makeScryfallCard({
        name: 'Sol Ring',
        set: 'lea',
        collector_number: '270',
        prices: { usd: '5.00' },
      }),
    ],
  })
}

const PRICED: ListsSummaryOptions['priced'] = {
  pricing: { source: 'tcgplayer' },
  refresh: 'never',
}

async function writeRaw(dir: string, file: string, lines: string[]): Promise<void> {
  await fs.writeFile(path.join(ws.dir, dir, file), lines.join('\n'))
}

/** Summarize, failing the test on a refusal. */
async function summarize(options: ListsSummaryOptions = {}): Promise<ListsSummary> {
  const result = await summarizeLists(options)
  if (isListsSummaryRefusal(result)) throw new Error(`refused: ${result.reason.message}`)
  return result
}

function slugs(summary: ListsSummary): string[] {
  return summary.lists.map((row) => `${row.listType}:${row.slug}`)
}

function rowOf(summary: ListsSummary, listType: string, slug: string): ListsSummaryRow {
  const row = summary.lists.find(
    (candidate) => candidate.listType === listType && candidate.slug === slug,
  )
  if (!row) throw new Error(`no row ${listType}:${slug} in ${slugs(summary).join(', ')}`)
  return row
}

/** Each warning's key and the list it names, if any. */
function warningKeys(summary: ListsSummary): (string | undefined)[][] {
  return summary.warnings.map((warning) => [
    warning.messageKey,
    warning.list?.listType,
    warning.list?.slug,
  ])
}

describe('summarizeLists — rows and counts', () => {
  test('one row per list with counts, metadata and identity, totals across all', async () => {
    await writeStandardLists()
    const summary = await summarize()

    expect(rowOf(summary, 'deck', 'burn')).toEqual({
      listType: 'deck',
      slug: 'burn',
      name: 'Burn',
      counts: {
        entryCount: 4,
        cardCount: 10,
        sections: [
          { name: 'Main', entryCount: 2, cardCount: 6 },
          { name: 'Sideboard', entryCount: 1, cardCount: 3 },
          { name: 'Maybeboard', entryCount: 1, cardCount: 1 },
        ],
      },
      labels: ['proxy'],
      description: 'Fast and red',
      format: 'modern',
    })
    expect(rowOf(summary, 'collection', 'binder')).toEqual({
      listType: 'collection',
      slug: 'binder',
      name: 'Trade Binder',
      labels: ['trade'],
      counts: {
        entryCount: 2,
        cardCount: 2,
        sections: [
          { name: 'Main', entryCount: 1, cardCount: 1 },
          { name: 'Artifacts', entryCount: 1, cardCount: 1 },
        ],
      },
    })
    expect(rowOf(summary, 'collection', 'empty').counts).toEqual({
      entryCount: 0,
      cardCount: 0,
      sections: [],
    })

    expect(summary.totals).toEqual({
      listCount: 5,
      entryCount: 9,
      cardCount: 15,
      // Bolt, Guide, Smash, Elves, Sol Ring, Mox Pearl.
      distinctCardCount: 6,
    })
    expect(summary.warnings).toEqual([])
    expect(summary.source).toBeUndefined()
    expect(summary.lists.every((row) => row.value === undefined)).toBe(true)
  })

  test('typeTotals appear only when the selection spans more than one type', async () => {
    await writeStandardLists()
    const all = await summarize()
    expect(all.typeTotals).toEqual([
      { listType: 'deck', listCount: 2, entryCount: 5, cardCount: 11, distinctCardCount: 4 },
      { listType: 'collection', listCount: 2, entryCount: 2, cardCount: 2, distinctCardCount: 2 },
      { listType: 'wanted', listCount: 1, entryCount: 2, cardCount: 2, distinctCardCount: 2 },
    ])
    expect((await summarize({ listType: 'deck' })).typeTotals).toBeUndefined()
  })

  test('typeTotals follow the selection under lists and label filters', async () => {
    await writeStandardLists()
    const picked = await summarize({
      lists: [
        { listType: 'deck', slug: 'burn' },
        { listType: 'collection', slug: 'binder' },
      ],
    })
    expect(picked.typeTotals?.map((totals) => [totals.listType, totals.listCount])).toEqual([
      ['deck', 1],
      ['collection', 1],
    ])
    // One list, so one type: no breakdown.
    expect((await summarize({ label: 'trade' })).typeTotals).toBeUndefined()
  })

  test('sections with no lines are not listed', async () => {
    await writeRaw('decks', 'sparse.md', [
      '# Sparse',
      '',
      '## Main',
      '',
      '1 Sol Ring',
      '',
      '## Sideboard',
      '',
    ])
    const summary = await summarize()
    expect(rowOf(summary, 'deck', 'sparse').counts.sections).toEqual([
      { name: 'Main', entryCount: 1, cardCount: 1 },
    ])
  })

  test('distinct names fold case across lists', async () => {
    await writeDeckFile(ws.dir, 'one', { cards: [{ name: 'Sol Ring', quantity: 1 }] })
    await writeDeckFile(ws.dir, 'two', { cards: [{ name: 'sol ring', quantity: 1 }] })
    expect((await summarize()).totals.distinctCardCount).toBe(1)
  })
})

describe('summarizeLists — selection', () => {
  test('listType keeps one type', async () => {
    await writeStandardLists()
    expect(slugs(await summarize({ listType: 'collection' }))).toEqual([
      'collection:empty',
      'collection:binder',
    ])
  })

  test('nameContains matches every term, any order, against the display name', async () => {
    await writeStandardLists()
    expect(slugs(await summarize({ nameContains: 'binder TRADE' }))).toEqual(['collection:binder'])
    expect(slugs(await summarize({ nameContains: 'trade box' }))).toEqual([])
  })

  test('lists selects exactly the refs, and a ref naming nothing is a warning', async () => {
    await writeStandardLists()
    const summary = await summarize({
      lists: [
        { listType: 'deck', slug: 'elves' },
        { listType: 'wanted', slug: 'wants' },
        { listType: 'deck', slug: 'missing' },
      ],
    })
    expect(slugs(summary)).toEqual(['wanted:wants', 'deck:elves'])
    expect(warningKeys(summary)).toEqual([['domain.list.summary.notFound', 'deck', 'missing']])
  })

  test('a ref of a type listType excludes is skipped silently, and a repeated ref once', async () => {
    await writeStandardLists()
    const summary = await summarize({
      listType: 'deck',
      lists: [
        { listType: 'deck', slug: 'elves' },
        { listType: 'deck', slug: 'elves' },
        { listType: 'collection', slug: 'binder' },
        { listType: 'collection', slug: 'nowhere' },
      ],
    })
    expect(slugs(summary)).toEqual(['deck:elves'])
    expect(summary.warnings).toEqual([])
  })

  test('label matches the list default labels', async () => {
    await writeStandardLists()
    expect(slugs(await summarize({ label: 'trade' }))).toEqual(['collection:binder'])
    expect(slugs(await summarize({ label: 'proxy' }))).toEqual(['deck:burn'])
  })

  test('format keeps only decks of that format', async () => {
    await writeStandardLists()
    expect(slugs(await summarize({ format: 'legacy' }))).toEqual(['deck:elves'])
    expect(slugs(await summarize({ format: 'legacy', listType: 'collection' }))).toEqual([])
  })

  test('includeEmpty: false drops lists with no entries', async () => {
    await writeStandardLists()
    expect(slugs(await summarize({ listType: 'collection' }))).toContain('collection:empty')
    expect(slugs(await summarize({ listType: 'collection', includeEmpty: false }))).toEqual([
      'collection:binder',
    ])
  })

  test('sections counts only those deck boards, rows and totals alike; flat lists unaffected', async () => {
    await writeStandardLists()
    const summary = await summarize({ sections: ['Main'] })
    expect(rowOf(summary, 'deck', 'burn').counts).toEqual({
      entryCount: 2,
      cardCount: 6,
      sections: [{ name: 'Main', entryCount: 2, cardCount: 6 }],
    })
    // The binder's Artifacts page still counts: sections name deck boards only.
    expect(rowOf(summary, 'collection', 'binder').counts.cardCount).toBe(2)
    // Smash to Smithereens lived only on the sideboard, so it is no longer a name.
    expect(summary.totals).toEqual({
      listCount: 5,
      entryCount: 2 + 1 + 2 + 0 + 2,
      cardCount: 6 + 1 + 2 + 0 + 2,
      distinctCardCount: 5,
    })
  })

  test('sections match case-sensitively, as get_list does', async () => {
    await writeStandardLists()
    const summary = await summarize({ listType: 'deck', sections: ['main'] })
    expect(summary.totals.cardCount).toBe(0)
  })

  test('includeEmpty: false judges a deck by its counted sections', async () => {
    await writeStandardLists()
    const summary = await summarize({ sections: ['Sideboard'], includeEmpty: false })
    // Elf Ball has no sideboard, so it is empty under this selection; the
    // flat lists keep their lines.
    expect(slugs(summary)).toEqual(['wanted:wants', 'deck:burn', 'collection:binder'])
  })
})

describe('summarizeLists — warnings', () => {
  test('a flat line the parser could not read is named by its list, its cause nested', async () => {
    await writeRaw('collections', 'broken.md', [
      '# Broken',
      '',
      '- Lightning Bolt (LEA:161) &1',
      '- Sol Ring &2',
      '',
    ])
    const summary = await summarize()
    expect(rowOf(summary, 'collection', 'broken').counts.entryCount).toBe(1)
    expect(warningKeys(summary)).toEqual([['domain.list.summary.inList', 'collection', 'broken']])
    const [warning] = summary.warnings
    expect(warning?.message).toStartWith('Broken: ')
    expect(warning?.messageParams?.list).toBe('Broken')
    expect(warning?.messageParams?.cause).toMatchObject({ messageKey: 'domain.card.line.atLine' })
  })

  test('a deck line the parser could not read is a warning too', async () => {
    await writeRaw('decks', 'typo.md', ['# Typo', '', '## Main', '', '1 Sol Ring', 'x Bolt', ''])
    const summary = await summarize()
    expect(rowOf(summary, 'deck', 'typo').counts.entryCount).toBe(1)
    expect(warningKeys(summary)).toEqual([['domain.list.summary.inList', 'deck', 'typo']])
    expect(summary.warnings[0]?.messageParams?.cause).toMatchObject({
      messageKey: 'domain.import.text.malformedLine',
    })
  })

  test('a fenced block is prose to a read-only summary, not a warning', async () => {
    await writeRaw('decks', 'notes.md', [
      '# Notes',
      '',
      '## Main',
      '',
      '1 Sol Ring',
      '',
      '```',
      'scratch',
      '```',
      '',
    ])
    expect((await summarize()).warnings).toEqual([])
  })

  test('a filtered-out list says nothing about its lines', async () => {
    await writeStandardLists()
    await writeRaw('collections', 'broken.md', ['# Broken', '', '- Sol Ring &2', ''])
    expect((await summarize({ listType: 'deck' })).warnings).toEqual([])
    expect((await summarize({ nameContains: 'trade' })).warnings).toEqual([])
  })

  test('a file that cannot be parsed is left out and said so', async () => {
    await writeStandardLists()
    await writeRaw('decks', 'mangled.md', [
      '---',
      'format: [unclosed',
      '---',
      '# Mangled',
      '',
      '## Main',
      '1 Sol Ring',
      '',
    ])
    const summary = await summarize({ listType: 'deck' })
    expect(slugs(summary)).toEqual(['deck:burn', 'deck:elves'])
    expect(warningKeys(summary)).toEqual([['domain.list.summary.unreadable', 'deck', 'mangled']])
    expect(summary.warnings[0]?.messageParams?.list).toBe('mangled')
    expect(summary.warnings[0]?.messageParams?.cause).toBeDefined()
  })
})

describe('summarizeLists — sort and limit', () => {
  test('name sorts ascending by display name, across types', async () => {
    await writeStandardLists()
    expect(slugs(await summarize())).toEqual([
      'wanted:wants',
      'collection:empty',
      'deck:burn',
      'deck:elves',
      'collection:binder',
    ])
  })

  test('descending reverses the name order', async () => {
    await writeStandardLists()
    expect(slugs(await summarize({ descending: true }))).toEqual([
      'collection:binder',
      'deck:elves',
      'deck:burn',
      'collection:empty',
      'wanted:wants',
    ])
  })

  test('quantity sorts descending; a tie falls back to name, not slug or type', async () => {
    await writeStandardLists()
    // The 2-copy tie: "Aardvark Wants" before "Trade Binder", although the
    // binder's slug and type both come first.
    expect(slugs(await summarize({ sort: 'quantity' }))).toEqual([
      'deck:burn',
      'wanted:wants',
      'collection:binder',
      'deck:elves',
      'collection:empty',
    ])
    expect(slugs(await summarize({ sort: 'quantity', descending: false }))).toEqual([
      'collection:empty',
      'deck:elves',
      'wanted:wants',
      'collection:binder',
      'deck:burn',
    ])
  })

  test('limit trims the rows, never the totals', async () => {
    await writeStandardLists()
    const full = await summarize()
    const limited = await summarize({ sort: 'quantity', limit: 2 })
    expect(slugs(limited)).toEqual(['deck:burn', 'wanted:wants'])
    expect(limited.totals).toEqual(full.totals)
    expect(limited.typeTotals).toEqual(full.typeTotals)
  })

  test('sorting by value without a price store is refused as a bad option', async () => {
    const result = await summarizeLists({ sort: 'value' })
    expect(result).toMatchObject({
      refused: 'options',
      reason: { messageKey: 'domain.list.summary.sortNeedsPricing' },
    })
  })
})

describe('checkListsSummaryOptions', () => {
  test('refuses what parsing would, before any store is resolved', () => {
    expect(checkListsSummaryOptions({ sections: [' '] }, true)?.reason.messageKey).toBe(
      'domain.list.summary.sectionsEmpty',
    )
    // A value sort needs only to know a store was asked for.
    expect(checkListsSummaryOptions({ sort: 'value' }, true)).toBeUndefined()
    expect(checkListsSummaryOptions({ sort: 'value' }, false)?.reason.messageKey).toBe(
      'domain.list.summary.sortNeedsPricing',
    )
  })
})

describe('summaryPricing', () => {
  test('a pricing is priced at the refresh mode; a reason is the unpriceable option', () => {
    const reason = syncMessage('domain.cache.cardKingdom.noFeed')
    expect(summaryPricing({ source: 'tcgplayer' }, 'never')).toEqual({
      pricing: { source: 'tcgplayer' },
      refresh: 'never',
    })
    expect(summaryPricing(reason, 'never')).toEqual({ unavailable: reason })
  })
})

describe('parseListsSummaryOptions', () => {
  function refusalKey(options: ListsSummaryOptions): string | undefined {
    const parsed = parseListsSummaryOptions(options)
    return isListsSummaryRefusal(parsed) ? parsed.reason.messageKey : undefined
  }

  test.each([0, -1, 1.5, Number.NaN])('limit %p is refused', (limit) => {
    expect(refusalKey({ limit })).toBe('domain.list.summary.limitInvalid')
  })

  test('empty lists, blank-only sections and an unpriced value sort are refused', () => {
    expect(refusalKey({ lists: [] })).toBe('domain.list.summary.listsEmpty')
    expect(refusalKey({ sections: [] })).toBe('domain.list.summary.sectionsEmpty')
    expect(refusalKey({ sections: ['  ', ''] })).toBe('domain.list.summary.sectionsEmpty')
    expect(refusalKey({ sort: 'value' })).toBe('domain.list.summary.sortNeedsPricing')
  })

  test('sections are trimmed, blanks dropped; defaults are resolved', () => {
    expect(
      parseListsSummaryOptions({
        sections: [' Main ', '', 'Sideboard'],
        nameContains: ' Trade  binder ',
        limit: 3,
      }),
    ).toEqual({
      nameTerms: ['trade', 'binder'],
      includeEmpty: true,
      sections: new Set(['Main', 'Sideboard']),
      sort: 'name',
      descending: false,
      limit: 3,
    })
    // quantity and value default to descending; an explicit direction wins.
    expect(parseListsSummaryOptions({ sort: 'value', priced: PRICED })).toEqual({
      nameTerms: [],
      includeEmpty: true,
      sort: 'value',
      descending: true,
      priced: PRICED,
    })
    expect(parseListsSummaryOptions({ sort: 'quantity', descending: false })).toMatchObject({
      descending: false,
    })
  })
})

describe('summarizeLists — value', () => {
  /** An unlabelled deck across three boards, plus the standard binder. */
  async function writePricedLists(): Promise<void> {
    await writeDeckFile(ws.dir, 'valued', {
      name: 'Valued',
      sections: [
        { name: 'Main', cards: [{ name: 'Lightning Bolt', quantity: 2 }] },
        { name: 'Sideboard', cards: [{ name: 'Sol Ring', quantity: 1 }] },
        { name: 'Maybeboard', cards: [{ name: 'Lightning Bolt', quantity: 3 }] },
      ],
    })
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Trade Binder',
      entries: [
        { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
        { name: 'Sol Ring', set: 'lea', collectorNumber: '270' },
      ],
    })
    await seedPrices()
  }

  test('a priced row carries exactly what single-list pricing reports', async () => {
    await writePricedLists()
    const summary = await summarize({ priced: PRICED, sort: 'value' })
    expect(summary.source).toBe('tcgplayer')
    expect(summary.currency).toBe('usd')

    const [binder] = (await listLocations('collection')).filter((l) => l.name === 'binder')
    const single = await loadAndBuildPriceReport(
      'collection',
      [binder!],
      { source: 'tcgplayer' },
      { refresh: 'never' },
    )
    const { type: _type, name, slug: _slug, ...singleTotals } = single.built.report.lists[0]!
    expect(name).toBe('Trade Binder')
    expect(rowOf(summary, 'collection', 'binder').value).toEqual(singleTotals)
    // Valued: Main 2 × $3 + Sideboard 1 × $5 = $11 against the binder's $8.
    expect(slugs(summary)).toEqual(['deck:valued', 'collection:binder'])
  })

  test('a section selection narrows the value; the maybeboard never prices', async () => {
    await writePricedLists()
    const summary = await summarize({ priced: PRICED, sections: ['Main', 'Maybeboard'] })
    const valued = rowOf(summary, 'deck', 'valued')
    expect(valued.counts.cardCount).toBe(5)
    // Two unpinned Bolts at their representative $3; the three maybeboard
    // copies are counted but never priced, and the sideboard is not selected.
    expect(valued.value).toEqual({
      cardCount: 2,
      total: 6,
      lowestTotal: 6,
      unpricedCount: 0,
      estimatedCount: 2,
    })
    const binderValue = {
      cardCount: 2,
      total: 8,
      lowestTotal: 8,
      unpricedCount: 0,
      estimatedCount: 0,
    }
    expect(rowOf(summary, 'collection', 'binder').value).toEqual(binderValue)
    const totalValue = {
      cardCount: 4,
      total: 14,
      lowestTotal: 14,
      unpricedCount: 0,
      estimatedCount: 2,
    }
    expect(summary.totals.value).toEqual(totalValue)
    expect(summary.typeTotals?.map((totals) => [totals.listType, totals.value])).toEqual([
      ['deck', valued.value],
      ['collection', binderValue],
    ])

    const limited = await summarize({ priced: PRICED, sections: ['Main', 'Maybeboard'], limit: 1 })
    expect(limited.lists).toHaveLength(1)
    expect(limited.totals).toEqual(summary.totals)
    expect(limited.typeTotals).toEqual(summary.typeTotals)
  })

  test('a deck and a collection sharing a slug are priced as two lists', async () => {
    await writeDeckFile(ws.dir, 'shared', { cards: [{ name: 'Sol Ring', quantity: 1 }] })
    await writeCollectionFile(ws.dir, 'shared', {
      entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
    })
    await seedPrices()
    const summary = await summarize({ priced: PRICED })
    expect(rowOf(summary, 'deck', 'shared').value?.total).toBe(5)
    expect(rowOf(summary, 'collection', 'shared').value?.total).toBe(3)
  })

  test('an unreadable art sidecar is a warning; the list still prices', async () => {
    await writePricedLists()
    await fs.writeFile(path.join(ws.dir, 'collections', 'binder.art.json'), 'not json')
    const summary = await summarize({ priced: PRICED })
    expect(warningKeys(summary)).toEqual([
      ['domain.list.summary.artUnreadable', 'collection', 'binder'],
    ])
    expect(summary.warnings[0]?.messageParams?.list).toBe('Trade Binder')
    expect(rowOf(summary, 'collection', 'binder').value?.total).toBe(8)
  })

  test('row values add up to one combined price report, overall and per type', async () => {
    await writePricedLists()
    await writeWantedFile(ws.dir, 'wants', {
      entries: [{ name: 'Sol Ring' }, { name: 'Mox Pearl' }],
    })
    const summary = await summarize({ priced: PRICED })
    const combined = await loadAndBuildPriceReport(
      undefined,
      undefined,
      { source: 'tcgplayer' },
      {
        refresh: 'never',
      },
    )
    const { entries } = combined.built.report
    expect(summary.totals.value).toEqual(sumPricedEntries(entries))
    expect(summary.typeTotals?.map((totals) => [totals.listType, totals.value])).toEqual(
      (['deck', 'collection', 'wanted'] as const).map((type) => [
        type,
        sumPricedEntries(entries.filter((entry) => entry.listType === type)),
      ]),
    )
  })

  test('an empty card cache still counts, with a warning and no value', async () => {
    await writeStandardLists()
    const summary = await summarize({ priced: PRICED, sort: 'quantity' })
    expect(summary.totals.cardCount).toBe(15)
    expect(summary.lists.every((row) => row.value === undefined)).toBe(true)
    expect(summary.totals.value).toBeUndefined()
    expect(summary.source).toBeUndefined()
    expect(warningKeys(summary)).toEqual([['domain.list.summary.cacheEmpty', undefined, undefined]])
  })

  test('a value sort over an empty card cache is refused as prices, as a store with none is', async () => {
    await writeStandardLists()
    expect(await summarizeLists({ priced: PRICED, sort: 'value' })).toEqual({
      refused: 'prices',
      reason: syncMessage('domain.list.summary.cacheEmpty'),
    })
  })
})

describe('summarizeLists — a store that cannot price', () => {
  const UNAVAILABLE = syncMessage('domain.cache.cardKingdom.noFeed')

  test('the counts stand, the reason is the first warning, and nothing is valued', async () => {
    await writeStandardLists()
    await writeRaw('collections', 'broken.md', ['# Broken', '', '- Sol Ring &1 [nonsense', ''])
    const summary = await summarize({ priced: { unavailable: UNAVAILABLE } })
    expect(summary.totals.cardCount).toBeGreaterThan(0)
    expect(summary.warnings[0]).toEqual(UNAVAILABLE)
    expect(summary.warnings.length).toBeGreaterThan(1)
    expect(summary.source).toBeUndefined()
    expect(summary.totals.value).toBeUndefined()
  })

  test('a value sort it cannot honor is refused with the store’s own reason', async () => {
    expect(await summarizeLists({ priced: { unavailable: UNAVAILABLE }, sort: 'value' })).toEqual({
      refused: 'prices',
      reason: UNAVAILABLE,
    })
  })

  test('a list that fails to price nests the error’s own key under its name', async () => {
    await writeCollectionFile(ws.dir, 'binder', {
      title: 'Trade Binder',
      entries: [{ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
    })
    await seedPrices()
    const failing: ListsSummaryOptions['priced'] = {
      pricing: {
        source: 'cardkingdom',
        cardKingdom: {
          quote: () => {
            throw localizedCommandError(
              'runtime_error',
              ExitCode.RuntimeError,
              'cli.price.emptyCache',
            )
          },
        },
        feedRetrievedAt: 0,
      },
      refresh: 'never',
    }
    const summary = await summarize({ priced: failing })
    const warning = summary.warnings.find(
      (candidate) => candidate.messageKey === 'domain.list.summary.priceFailed',
    )
    expect(warning?.list).toEqual({ listType: 'collection', slug: 'binder' })
    expect(warning?.messageParams?.cause).toEqual({ messageKey: 'cli.price.emptyCache' })
  })
})

describe('groupRowsByType', () => {
  function row(listType: ListsSummaryRow['listType'], slug: string): ListsSummaryRow {
    return { listType, slug, name: slug, counts: { entryCount: 0, cardCount: 0, sections: [] } }
  }

  test('groups in canonical type order, keeping row order, omitting empty types', () => {
    const groups = groupRowsByType([
      row('wanted', 'w1'),
      row('deck', 'd2'),
      row('wanted', 'w2'),
      row('deck', 'd1'),
    ])
    expect(groups.map((group) => [group.listType, group.rows.map((r) => r.slug)])).toEqual([
      ['deck', ['d2', 'd1']],
      ['wanted', ['w1', 'w2']],
    ])
  })
})
