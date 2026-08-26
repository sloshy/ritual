import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
// scryfall must load before src/cache: cache/index transitively imports
// scryfall/index, which reads `cardCache` at module top level — importing the
// cache first leaves that binding in its temporal dead zone.
import '../../src/scryfall'
import type { PriceSummaryPayload } from '../../src/pricing/price-report'
import type { ScryfallCard } from '../../src/scryfall/types'
import { makeCardKingdomProduct, makeScryfallCard } from '../test-utils'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { seedCardCache, seedCardKingdomFeed } from './helpers/seed'
import { createWorkspace, removeWorkspace, writeCollectionFile } from './helpers/workspace'

// `price --source` wiring only: the CK pricing rules themselves are pinned in
// test/unit/price-report-cardkingdom.test.ts.

const SEED_CARDS: Record<string, ScryfallCard[]> = {
  'Sol Ring': [
    makeScryfallCard({
      id: 'it-sol-c21',
      name: 'Sol Ring',
      set: 'c21',
      collector_number: '263',
      finishes: ['nonfoil'],
      prices: { usd: '1.99', eur: '1.10' },
    }),
  ],
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
  await seedCardCache(dir, SEED_CARDS)
  await seedCardKingdomFeed(dir, [
    makeCardKingdomProduct({
      id: 10,
      sku: 'C21-263',
      scryfallId: 'it-sol-c21',
      name: 'Sol Ring',
      edition: 'Commander 2021',
      priceRetail: 3.49,
      qtyRetail: 4,
    }),
  ])
  await writeCollectionFile(dir, 'binder', {
    entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
  })
})

afterEach(async () => {
  await removeWorkspace(dir)
})

async function summary(args: string[]): Promise<PriceSummaryPayload> {
  const result = await runCli(
    ['price', '--summary', '--output', 'json', '--refresh', 'never', ...args],
    dir,
    OFFLINE_ENV,
  )
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout) as PriceSummaryPayload
}

describe('price --source (Integration)', () => {
  test('--source cardkingdom prices from the cached feed, USD, and stamps the payload', async () => {
    const payload = await summary(['--source', 'cardkingdom'])
    expect(payload.currency).toBe('usd')
    expect(payload.source).toBe('cardkingdom')
    expect(payload.totals.total).toBeCloseTo(3.49)
  })

  test('--source cardmarket is Scryfall EUR; --source tcgplayer is the default USD', async () => {
    const eur = await summary(['--source', 'cardmarket'])
    expect(eur.currency).toBe('eur')
    expect(eur.source).toBeUndefined()
    expect(eur.totals.total).toBeCloseTo(1.1)

    const usd = await summary(['--source', 'tcgplayer'])
    expect(usd.currency).toBe('usd')
    expect(usd.totals.total).toBeCloseTo(1.99)
  })

  test('a conflicting --prices is a usage error', async () => {
    const result = await runCli(
      ['price', '--summary', '--source', 'cardkingdom', '--prices', 'eur', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('cardkingdom')
  })

  test('--source cardkingdom with no cached feed is a runtime error, not a Scryfall fallback', async () => {
    await fs.rm(path.join(dir, 'cache', 'cardkingdom.json'))
    const result = await runCli(
      ['price', '--summary', '--source', 'cardkingdom', '--refresh', 'never'],
      dir,
      OFFLINE_ENV,
    )
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('No Card Kingdom buylist')
  })

  test('an unknown store is rejected at parse time', async () => {
    const result = await runCli(['price', '--source', 'ebay'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(2)
    expect(result.stderr.toLowerCase()).toContain('price source')
  })
})
