import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import { sellDisclaimer } from '../../src/commands/sell'
import type { SellReportPayload } from '../../src/pricing/sell-report'
import type { ScryfallCard } from '../../src/scryfall/types'
import { makeCardKingdomProduct, makeScryfallCard } from '../test-utils'
import { runCli } from './helpers/cli'
import { seedCardCache, seedCardKingdomFeed } from './helpers/seed'
import { OFFLINE_ENV } from './helpers/offline-env'
import { createWorkspace, removeWorkspace, writeCollectionFile } from '../helpers/workspace'

// ── Synthetic caches ──────────────────────────────────────────────────────────
// sell resolves printings from the local card cache and offers from the cached
// Card Kingdom feed; both are seeded synthetically so nothing reaches the
// network (OFFLINE_ENV backstops that). Engine semantics are pinned in
// test/unit/sell-report.test.ts — this suite covers CLI wiring: flags, output
// formats, exit codes, and the missing-feed refusal.

const SEED_CARDS: Record<string, ScryfallCard[]> = {
  'Sol Ring': [
    makeScryfallCard({
      id: 'it-sol-c21',
      name: 'Sol Ring',
      set: 'c21',
      collector_number: '263',
      finishes: ['nonfoil', 'foil'],
    }),
  ],
  'Lightning Bolt': [
    makeScryfallCard({
      id: 'it-bolt-lea',
      name: 'Lightning Bolt',
      set: 'lea',
      collector_number: '161',
      finishes: ['nonfoil'],
    }),
  ],
}

async function writeFeedCache(dir: string): Promise<void> {
  await seedCardKingdomFeed(dir, [
    makeCardKingdomProduct({
      id: 10,
      sku: 'C21-263',
      scryfallId: 'it-sol-c21',
      name: 'Sol Ring',
      edition: 'Commander 2021',
      priceBuy: 1.2,
      qtyBuying: 10,
    }),
    makeCardKingdomProduct({
      id: 11,
      sku: 'FC21-263',
      scryfallId: 'it-sol-c21',
      name: 'Sol Ring',
      edition: 'Commander 2021',
      finish: 'foil',
      priceBuy: 2,
      qtyBuying: 1,
    }),
    makeCardKingdomProduct({
      id: 12,
      sku: 'LEA-161',
      scryfallId: 'it-bolt-lea',
      name: 'Lightning Bolt',
      edition: 'Alpha',
      priceBuy: 30,
      qtyBuying: 0,
    }),
  ])
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await seedCardCache(dir, SEED_CARDS)
  await writeFeedCache(dir)
  await writeCollectionFile(dir, 'binder', {
    entries: [
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', finish: 'foil', cardId: 3 },
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 4 },
    ],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('sell CLI (Integration)', () => {
  test('reports the collection against the cached feed as JSON', async () => {
    const result = await runCli(
      ['sell', '--output', 'json', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout) as SellReportPayload
    expect(payload.feedCreatedAt).toBe('2026-08-04 06:06:09')

    // Two aggregated nonfoil copies, one foil copy, one not-buying Bolt.
    expect(payload.entries).toHaveLength(3)
    const nonfoil = payload.entries.find((e) => e.name === 'Sol Ring' && e.finish === 'nonfoil')
    expect(nonfoil).toMatchObject({
      status: 'buying',
      quantity: 2,
      priceBuy: 1.2,
      sellableQuantity: 2,
      value: 2.4,
      ckSku: 'C21-263',
      ckFinish: 'nonfoil',
    })
    // CK only takes 1 of the foil.
    const foil = payload.entries.find((e) => e.finish === 'foil')
    expect(foil).toMatchObject({ priceBuy: 2, sellableQuantity: 1 })
    const bolt = payload.entries.find((e) => e.name === 'Lightning Bolt')
    expect(bolt).toMatchObject({ status: 'not-buying', sellableQuantity: 0 })

    expect(payload.totals).toMatchObject({
      listCount: 1,
      cardCount: 4,
      sellableCount: 3,
      totalValue: 4.4,
      notBuyingCount: 1,
      noMatchCount: 0,
    })
  })

  test('renders a text report with the disclaimer and totals', async () => {
    const result = await runCli(['sell', '--refresh', 'never'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('[collection] binder')
    expect(result.stdout).toContain('Total: $4.40 for 3 of 4 cards across 1 list')
    expect(result.stdout).toContain(sellDisclaimer())
  })

  test('--min filters offers and recomputes totals', async () => {
    const result = await runCli(
      ['sell', '--min', '1.5', '--output', 'json', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    const payload = JSON.parse(result.stdout) as SellReportPayload
    // The $1.20 nonfoil offer drops; the $2.00 foil stays, and so does the
    // not-buying Bolt — --min filters the quote, not the status.
    expect(payload.entries).toHaveLength(2)
    expect(payload.entries.map((e) => e.name).sort()).toEqual(['Lightning Bolt', 'Sol Ring'])
    expect(payload.totals.totalValue).toBe(2)
    expect(payload.filters.minPrice).toBe(1.5)
  })

  test('--sets normalizes its codes and filters to them', async () => {
    const result = await runCli(
      ['sell', '--sets', 'C21', '--output', 'json', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    const payload = JSON.parse(result.stdout) as SellReportPayload
    expect(payload.filters.sets).toEqual(['c21'])
    expect(payload.entries).toHaveLength(2)
    expect(payload.entries.every((e) => e.set === 'c21')).toBe(true)
  })

  test('--output ndjson emits one entry per line', async () => {
    const result = await runCli(
      ['sell', '--output', 'ndjson', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test('--output csv renders the CK sell-cart upload, capped at their buy limits', async () => {
    const result = await runCli(['sell', '--output', 'csv', '--refresh', 'never'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Sol Ring,Commander 2021,false,2\nSol Ring,Commander 2021,true,1\n')
  })

  test('--out writes the payload to a file instead of stdout', async () => {
    const result = await runCli(
      ['sell', '--output', 'csv', '--out', 'to-sell.csv', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Wrote ')
    const written = await fs.readFile(path.join(dir, 'to-sell.csv'), 'utf-8')
    expect(written).toContain('Sol Ring,Commander 2021,false,2')
  })

  test('a missing feed under --refresh never is a runtime error naming the remedy', async () => {
    await fs.rm(path.join(dir, 'cache', 'cardkingdom.json'))
    const result = await runCli(
      ['sell', '--output', 'json', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--refresh auto')
  })

  test('an empty card cache under --refresh never is a runtime error with the advice', async () => {
    await fs.rm(path.join(dir, 'cache', 'cache.json'))
    const result = await runCli(['sell', '--refresh', 'never'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('cache preload-all')
  })

  test('conflicting type flags are a usage error', async () => {
    const result = await runCli(['sell', '--deck', '--collection'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('only one of')
  })

  test('an unknown list name is not found', async () => {
    const result = await runCli(['sell', 'no-such-list', '--refresh', 'never'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('no-such-list')
  })
})
