import { describe, expect, test } from 'bun:test'
import {
  createScryfallIdIndex,
  type CardPrintingsSource,
} from '../../../src/cache/scryfall-id-index'
import { makeScryfallCard } from '../../test-utils'
import type { ScryfallCard } from '../../../src/scryfall/types'

/**
 * The cache is keyed by card name, so ID lookups run off a memoized index. What
 * matters is that IDs — not names — resolve, that the memo is actually reused,
 * and that it still notices cards added after it was built, but no more often
 * than the cooldown allows.
 */

function card(id: string, name: string): ScryfallCard {
  return makeScryfallCard({ id, name })
}

type CountingCardSource = CardPrintingsSource & { scans: number }

/** A cache stand-in that counts the scans the index makes over it. */
function source(printings: ScryfallCard[][]): CountingCardSource {
  return {
    scans: 0,
    values(): Promise<ScryfallCard[][]> {
      this.scans += 1
      return Promise.resolve(printings)
    },
  }
}

describe('ScryfallIdIndex', () => {
  test('language objects sharing a set:cn each keep their own id entry', async () => {
    // An all_cards-backed cache: same printing (set + collector number) in two
    // languages, distinct Scryfall ids. The index is id-keyed, so neither
    // clobbers the other.
    const en = makeScryfallCard({ id: 'shock-en', name: 'Shock', set: 'p1', collector_number: '7' })
    const ja: ScryfallCard = { ...en, id: 'shock-ja', lang: 'ja' }
    const index = createScryfallIdIndex(source([[en, ja]]))

    const found = await index.lookup(['shock-en', 'shock-ja'])

    expect(found.get('shock-en')?.lang).toBeUndefined()
    expect(found.get('shock-ja')?.lang).toBe('ja')
  })

  test('resolves every printing by its own id, and never by card name', async () => {
    const cache = source([
      [card('bolt-lea', 'Lightning Bolt'), card('bolt-sta', 'Lightning Bolt')],
      [card('ring-c21', 'Sol Ring')],
    ])
    const index = createScryfallIdIndex(cache)

    // 'Sol Ring' is a cached *name*, not an id — it must not resolve.
    const found = await index.lookup(['bolt-sta', 'ring-c21', 'Sol Ring', 'ghost'])

    expect([...found.keys()].sort()).toEqual(['bolt-sta', 'ring-c21'])
    // Two printings share a name; each keeps its own entry.
    expect(found.get('bolt-sta')?.name).toBe('Lightning Bolt')
    expect((await index.lookup(['bolt-lea'])).get('bolt-lea')?.id).toBe('bolt-lea')
  })

  test('no ids means no scan at all', async () => {
    const cache = source([[card('bolt-lea', 'Lightning Bolt')]])
    expect((await createScryfallIdIndex(cache).lookup([])).size).toBe(0)
    expect(cache.scans).toBe(0)
  })

  test('reuses the built index rather than rescanning per lookup', async () => {
    const cache = source([[card('bolt-lea', 'Lightning Bolt')]])
    const index = createScryfallIdIndex(cache)

    await index.lookup(['bolt-lea'])
    await index.lookup(['bolt-lea'])

    expect(cache.scans).toBe(1)
  })

  test('concurrent lookups share one build', async () => {
    const cache = source([[card('bolt-lea', 'Lightning Bolt')]])
    const index = createScryfallIdIndex(cache)

    await Promise.all([
      index.lookup(['bolt-lea']),
      index.lookup(['bolt-lea']),
      index.lookup(['ghost']),
    ])

    expect(cache.scans).toBe(1)
  })

  test('a miss inside the cooldown does not rescan, so unknown ids stay cheap', async () => {
    const printings = [[card('bolt-lea', 'Lightning Bolt')]]
    const cache = source(printings)
    let now = 1_000
    const index = createScryfallIdIndex(cache, () => now)

    await index.lookup(['bolt-lea'])
    printings.push([card('ring-c21', 'Sol Ring')])
    now += 29_000

    expect((await index.lookup(['ring-c21'])).size).toBe(0)
    expect(cache.scans).toBe(1)
  })

  test('a miss past the cooldown rebuilds, picking up newly cached cards', async () => {
    const printings = [[card('bolt-lea', 'Lightning Bolt')]]
    const cache = source(printings)
    let now = 1_000
    const index = createScryfallIdIndex(cache, () => now)

    await index.lookup(['bolt-lea'])
    // Something else cached this name after the index was built — e.g. the
    // printings endpoint fetching it on demand.
    printings.push([card('ring-c21', 'Sol Ring')])
    now += 31_000

    const found = await index.lookup(['bolt-lea', 'ring-c21'])
    expect([...found.keys()].sort()).toEqual(['bolt-lea', 'ring-c21'])
    expect(cache.scans).toBe(2)
  })

  test('reset drops the memo, so a card removed from the cache stops resolving', async () => {
    const printings = [[card('bolt-lea', 'Lightning Bolt')]]
    const cache = source(printings)
    const index = createScryfallIdIndex(cache)

    await index.lookup(['bolt-lea'])
    printings.length = 0
    index.reset()

    expect((await index.lookup(['bolt-lea'])).size).toBe(0)
    expect(cache.scans).toBe(2)
  })
})
