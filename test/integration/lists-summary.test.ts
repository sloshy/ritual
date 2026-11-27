import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import type { ListsSummaryPayload } from '../../src/summary/lists'
import type { ScryfallCard } from '../../src/scryfall/types'
import { makeScryfallCard } from '../test-utils'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { seedCardCache } from './helpers/seed'
import {
  createWorkspace,
  removeWorkspace,
  writeCollectionFile,
  writeDeckFile,
  writeWantedFile,
  type CollectionFixtureEntry,
} from '../helpers/workspace'

// `lists --summary` wiring: flags → engine options, JSON and text output, exit
// codes, and pricing through the run's --refresh policy. The summary's own
// semantics are pinned in test/unit/list-summary.test.ts; the four acceptance
// questions of the feature are each one call here.

const SEED_CARDS: Record<string, ScryfallCard[]> = {
  'Sol Ring': [
    makeScryfallCard({
      id: 'it-sol-c21',
      name: 'Sol Ring',
      set: 'c21',
      collector_number: '263',
      finishes: ['nonfoil'],
      prices: { usd: '2.00' },
    }),
  ],
  'Lightning Bolt': [
    makeScryfallCard({
      id: 'it-bolt-m10',
      name: 'Lightning Bolt',
      set: 'm10',
      collector_number: '146',
      finishes: ['nonfoil'],
      prices: { usd: '1.00' },
    }),
  ],
}

/** `count` collection copies of one printing, one line each, with ids from `firstId`. */
function copies(
  name: 'Sol Ring' | 'Lightning Bolt',
  count: number,
  firstId: number,
): CollectionFixtureEntry[] {
  const printing = name === 'Sol Ring' ? { set: 'c21', cn: '263' } : { set: 'm10', cn: '146' }
  return Array.from({ length: count }, (_, index) => ({
    name,
    set: printing.set,
    collectorNumber: printing.cn,
    cardId: firstId + index,
  }))
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await seedCardCache(dir, SEED_CARDS)
  // Collections worth $6, $1, $2 and $2 (Sol Ring $2, Lightning Bolt $1).
  await writeCollectionFile(dir, 'box', { title: 'Card Box', entries: copies('Sol Ring', 3, 1) })
  await writeCollectionFile(dir, 'binder', {
    title: 'Trade Binder',
    entries: copies('Lightning Bolt', 1, 1),
  })
  await writeCollectionFile(dir, 'shoebox', {
    title: 'Shoebox',
    entries: copies('Lightning Bolt', 2, 1),
  })
  await writeCollectionFile(dir, 'vault', { title: 'Vault', entries: copies('Sol Ring', 1, 1) })
  await writeDeckFile(dir, 'burn', {
    name: 'Burn',
    frontMatter: { format: 'modern' },
    sections: [
      { name: 'Main', cards: [{ quantity: 4, name: 'Lightning Bolt', cardId: 1 }] },
      { name: 'Sideboard', cards: [{ quantity: 2, name: 'Sol Ring', cardId: 2 }] },
      { name: 'Maybeboard', cards: [{ quantity: 1, name: 'Sol Ring', cardId: 3 }] },
    ],
  })
  // Two more decks for the selection filters: a modern deck smaller than Burn,
  // and an empty one, which --no-empty leaves out.
  await writeDeckFile(dir, 'stompy', {
    name: 'Stompy',
    frontMatter: { format: 'modern' },
    cards: [{ quantity: 2, name: 'Lightning Bolt', cardId: 1 }],
  })
  await writeDeckFile(dir, 'empty', { name: 'Empty', frontMatter: { format: 'modern' } })
  await writeWantedFile(dir, 'wants', {
    title: 'Boxed Wants',
    entries: [{ name: 'Sol Ring', cardId: 1 }],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

/** Run `lists --summary --output json` with `args`, offline, and parse the payload. */
async function summary(args: string[]): Promise<ListsSummaryPayload> {
  const result = await runCli(
    ['lists', '--summary', '--output', 'json', '--refresh', 'never', ...args],
    dir,
    OFFLINE_ENV,
  )
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout) as ListsSummaryPayload
}

describe('lists --summary (Integration)', () => {
  test('total cards across all collections', async () => {
    const payload = await summary(['--collection'])
    expect(payload.totals).toMatchObject({ listCount: 4, cardCount: 7 })
    // Counting alone: no store, so no value anywhere.
    expect(payload.source).toBeUndefined()
    expect(payload.totals.value).toBeUndefined()
    expect('lastRefreshedAt' in payload).toBe(false)
  })

  test('counts for every list whose name contains "box"', async () => {
    const payload = await summary(['--name', 'box'])
    expect(payload.lists.map((row) => `${row.listType}:${row.slug}`)).toEqual([
      'wanted:wants',
      'collection:box',
      'collection:shoebox',
    ])
    expect(payload.lists.find((row) => row.slug === 'box')?.counts.cardCount).toBe(3)
  })

  test('every deck with its main, sideboard and maybeboard counts', async () => {
    const payload = await summary(['--deck'])
    expect(payload.lists.map((row) => row.slug)).toEqual(['burn', 'empty', 'stompy'])
    expect(payload.lists[0]?.counts.sections).toEqual([
      { name: 'Main', entryCount: 1, cardCount: 4 },
      { name: 'Sideboard', entryCount: 1, cardCount: 2 },
      { name: 'Maybeboard', entryCount: 1, cardCount: 1 },
    ])
  })

  test('collections ordered by value, top three', async () => {
    const payload = await summary([
      '--collection',
      '--source',
      'tcgplayer',
      '--sort',
      'value',
      '--limit',
      '3',
    ])
    expect(payload.lists.map((row) => row.slug)).toEqual(['box', 'shoebox', 'vault'])
    expect(payload.lists[0]?.value?.total).toBeCloseTo(6)
    // The limit trims rows; the totals still cover every collection.
    expect(payload.totals.listCount).toBe(4)
    expect(payload.totals.value?.total).toBeCloseTo(11)
    expect(payload).toMatchObject({ source: 'tcgplayer', currency: 'usd' })
    expect(typeof payload.lastRefreshedAt).toBe('number')
  })

  test('format, sections, emptiness and direction combine', async () => {
    const payload = await summary([
      '--deck',
      '--format',
      'modern',
      '--section',
      'Main',
      '--section',
      'Sideboard',
      '--no-empty',
      '--sort',
      'quantity',
      '--ascending',
    ])
    // Empty is left out; quantity, which defaults to largest first, runs up.
    expect(payload.lists.map((row) => row.slug)).toEqual(['stompy', 'burn'])
    // Burn's Maybeboard copy is not in the counted sections.
    expect(payload.lists[1]?.counts.cardCount).toBe(6)
    expect(payload.totals.cardCount).toBe(8)
  })

  test('a bad option is refused before anything is fetched for the prices', async () => {
    // --refresh auto would download Card Kingdom's missing feed: the bad
    // section must stop the run first, so no feed is written or asked for.
    const result = await runCli(
      ['lists', '--summary', '--source', 'cardkingdom', '--section', ' ', '--refresh', 'auto'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Name at least one deck section')
    expect(result.stderr).not.toContain('Card Kingdom')
    expect(await Bun.file(path.join(dir, 'cache', 'cardkingdom.json')).exists()).toBe(false)
  })

  test('both directions at once is a usage error', async () => {
    const result = await runCli(
      ['lists', '--summary', '--ascending', '--descending'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(2)
  })

  test('lists named by position: a match, a miss (exit 3), an ambiguity (exit 2)', async () => {
    const named = await summary(['shoebox', 'deck:burn'])
    expect(named.lists.map((row) => `${row.listType}:${row.slug}`)).toEqual([
      'deck:burn',
      'collection:shoebox',
    ])
    const missing = await runCli(['lists', '--summary', 'nowhere'], dir, OFFLINE_ENV)
    expect(missing.exitCode).toBe(3)
    // "bo" is part of Card Box, Trade Binder and Shoebox alike.
    const ambiguous = await runCli(['lists', '--summary', '--collection', 'bo'], dir, OFFLINE_ENV)
    expect(ambiguous.exitCode).toBe(2)
  })

  test('--output ndjson is one row per line', async () => {
    const result = await runCli(
      ['lists', '--summary', '--collection', '--output', 'ndjson'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const rows = result.stdout
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as { slug: string })
    expect(rows.map((row) => row.slug)).toEqual(['box', 'shoebox', 'binder', 'vault'])
  })

  test('Card Kingdom with no cached feed still counts, and says why there is no value', async () => {
    const result = await runCli(
      [
        'lists',
        '--summary',
        '--collection',
        '--source',
        'cardkingdom',
        '--output',
        'json',
        '--refresh',
        'never',
      ],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const counted = JSON.parse(result.stdout) as ListsSummaryPayload
    expect(counted.totals.cardCount).toBe(7)
    expect(counted.source).toBeUndefined()
    expect(counted.warnings[0]?.messageKey).toBe('domain.cache.cardKingdom.missingAdvice')
    expect(result.stderr).toContain('No Card Kingdom buylist')
  })

  test('a value sort with no Card Kingdom feed is a runtime error; with no store, a usage error', async () => {
    const noFeed = await runCli(
      ['lists', '--summary', '--source', 'cardkingdom', '--sort', 'value', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(noFeed.exitCode).toBe(1)
    const noStore = await runCli(['lists', '--summary', '--sort', 'value'], dir, OFFLINE_ENV)
    expect(noStore.exitCode).toBe(2)
  })

  test('the text table lists each row, then the totals', async () => {
    const result = await runCli(['lists', '--summary', 'deck:burn'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trimEnd().split('\n')
    // The file name differs from the display name, so it gets its own column.
    expect(lines[0]).toMatch(/^Type\s+Name\s+File\s+Entries\s+Cards$/)
    expect(lines[1]).toMatch(/^deck\s+Burn\s+burn\s+3\s+7$/)
    expect(lines.at(-1)).toBe('All lists: 1 list · 3 entries · 7 cards · 2 distinct cards')
  })

  test('a summary option or a list name without --summary is a usage error', async () => {
    const flag = await runCli(['lists', '--name', 'box'], dir, OFFLINE_ENV)
    expect(flag.exitCode).toBe(2)
    expect(flag.stderr).toContain('--summary')
    expect(flag.stderr).toContain('--name')
    const positional = await runCli(['lists', 'burn'], dir, OFFLINE_ENV)
    expect(positional.exitCode).toBe(2)
    expect(positional.stderr).toContain('--summary: burn')
  })
})
