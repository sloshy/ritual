import { beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeListDetails, type LoadedList, type SourceLoad } from '../../../src/site-build/lists'
import type { SkippedSource, SourceCategory } from '../../../src/site-build/sources'
import type { SiteDetailContext } from '../../../src/site-build/types'
import type { CollectionSummary, ListSummary } from '../../../src/list/site-data'
import type { ListType } from '../../../src/list/list-type'

/**
 * The write pass's bookkeeping, with lists already loaded: what is reported as
 * skipped, what is never written, and the one asymmetry between kinds (a deck
 * with no cards still gets a page; a flat list does not).
 */

const ctx: SiteDetailContext = {
  cardData: { cards: {}, printings: {}, cheapest: {}, missing: {} },
  resolveCardName: () => Promise.resolve(null),
  getPrintings: () => Promise.resolve([]),
  bannedPrintings: new Set(),
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  pricesDate: '2026-07-24T00:00:00.000Z',
}

const SUMMARY: CollectionSummary = {
  slug: 'binder',
  name: 'Binder',
  featuredCardImage: '',
  cardCount: 0,
  totalPrice: 0,
  totalPriceEur: 0,
  totalPriceTix: 0,
}

function category(kind: ListType, explicit: boolean, loads: SourceLoad[]): SourceCategory {
  const sources = loads.map((load) => load.source)
  return {
    kind,
    dir: `/${kind}`,
    selection: explicit
      ? { explicit: true, sources, missing: [], ambiguous: [] }
      : { explicit: false, sources, unmatchedIncludes: [] },
    buildable: sources,
  }
}

/** How many lists the write pass asked to build. */
let builds = 0
beforeEach(() => {
  builds = 0
})

type Run = {
  summaries: ListSummary[]
  skipped: SkippedSource[]
  built: number
  files: string[]
  logged: string[]
}

async function run(
  kind: ListType,
  explicit: boolean,
  lists: (LoadedList | string)[],
): Promise<Run> {
  const buildDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-lists-'))
  const skipped: SkippedSource[] = []
  const logged: string[] = []
  const log = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
  })
  try {
    const loads: SourceLoad[] = lists.map((list, i) => ({
      source: { basename: `file-${i}`, displayName: `List ${i}` },
      list,
    }))
    const summaries = await writeListDetails({
      category: category(kind, explicit, loads),
      loads,
      buildDir,
      detailCtx: ctx,
      skipSource: (source) => skipped.push(source),
      loadingMessage: kind === 'deck' ? undefined : 'Loading...',
    })
    const files = await fs.readdir(buildDir, { recursive: true })
    return { summaries, skipped, built: builds, files: files.map(String), logged }
  } finally {
    log.mockRestore()
    await fs.rm(buildDir, { recursive: true, force: true })
  }
}

function list(kind: ListType, isEmpty: boolean): LoadedList {
  return {
    kind,
    name: 'Binder',
    warnings: [],
    isEmpty,
    cardNames: () => Promise.resolve([]),
    build: () => {
      builds += 1
      return Promise.resolve({ slug: SUMMARY.slug, detail: { ok: true }, summary: SUMMARY })
    },
  }
}

describe('writeListDetails', () => {
  test('a load that failed is skipped with its reason and writes nothing', async () => {
    const result = await run('collection', true, ['front matter is broken'])
    expect(result.skipped).toEqual([
      { kind: 'collection', name: 'List 0', reason: 'front matter is broken', explicit: true },
    ])
    expect(result.summaries).toEqual([])
    expect(result.built).toBe(0)
    expect(result.files.filter((f) => f.endsWith('.json'))).toEqual([])
  })

  test('an empty flat list is announced and skipped, not written', async () => {
    const result = await run('wanted', false, [list('wanted', true)])
    expect(result.skipped).toEqual([])
    expect(result.summaries).toEqual([])
    expect(result.built).toBe(0)
    expect(result.files.filter((f) => f.endsWith('.json'))).toEqual([])
    expect(result.logged.some((line) => line.includes('no valid entries'))).toBeTrue()
  })

  test('a deck is never empty-skipped: its page is built and written', async () => {
    const result = await run('deck', false, [list('deck', false)])
    expect(result.built).toBe(1)
    expect(result.summaries).toEqual([SUMMARY])
    expect(result.files).toContain(path.join('decks', 'binder.json'))
  })
})
