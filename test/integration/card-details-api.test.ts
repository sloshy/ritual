import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  handleCardDetails,
  type CardDetailsFailure,
  type CardDetailsResponse,
} from '../../src/api/card-details'
import { cardCache } from '../../src/cache'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { stubFetch, type StubbedFetch } from './helpers/stub-fetch'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard } from '../../src/scryfall/types'

/**
 * `GET /api/card-details` against a throwaway workspace whose Scryfall cache is
 * seeded through the real `cardCache.bulkSet`. The oracle-level fields the route
 * exists to expose (colors, keywords, legalities, tags) only reach the response
 * if they survive the cache round trip, so they are seeded here rather than
 * stubbed at the projection.
 */

/**
 * One Lightning Bolt printing. The two differ only in identity, so the shared
 * oracle-level fields live here once.
 */
function boltPrinting(set: string, collectorNumber: string, releasedAt: string): ScryfallCard {
  return makeScryfallCard({
    id: `bolt-${set}`,
    name: 'Lightning Bolt',
    set,
    collector_number: collectorNumber,
    released_at: releasedAt,
    mana_cost: '{R}',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    color_identity: ['R'],
    colors: ['R'],
    keywords: [],
    legalities: { commander: 'legal', standard: 'not_legal', modern: 'legal' },
    oracleTags: ['burn'],
    artTags: ['lightning'],
  })
}

// Seeded oldest-first, so the newest-first ordering the route promises has to do
// real work rather than passing on the fixture's order.
const BOLT_PRINTINGS: ScryfallCard[] = [
  boltPrinting('lea', '161', '1993-08-05'),
  boltPrinting('2xm', '129', '2020-08-07'),
]

let workspace: BoundWorkspace
let stubbed: StubbedFetch

beforeAll(async () => {
  workspace = await bindWorkspace({ init: true, clearCardCache: true })
  // An uncached name falls back to a single-card Scryfall fetch; answer 404 so the
  // miss path is exercised without reaching the network.
  stubbed = stubFetch({
    'https://api.scryfall.com': () => Response.json({ object: 'error' }, { status: 404 }),
  })
  await cardCache.bulkSet({ 'Lightning Bolt': BOLT_PRINTINGS })
})

afterAll(async () => {
  stubbed.restore()
  await workspace.dispose()
})

async function details(query: string): Promise<{ status: number; body: CardDetailsResponse }> {
  const resp = await handleCardDetails(new Request(`http://localhost/api/card-details?${query}`))
  return { status: resp.status, body: (await resp.json()) as CardDetailsResponse }
}

/** Narrow a response to its failure arm, failing the test if it is not one. */
function failure(body: CardDetailsResponse): CardDetailsFailure {
  expect(body.success).toBeFalse()
  if (body.success) throw new Error('expected the failure arm')
  return body
}

describe('handleCardDetails', () => {
  test('reports the cached card with its oracle-level fields and printing count', async () => {
    const { status, body } = await details('name=Lightning%20Bolt')
    expect(status).toBe(200)
    expect(body.success).toBeTrue()
    expect(body.card).toMatchObject({
      name: 'Lightning Bolt',
      manaCost: '{R}',
      cmc: 1,
      typeLine: 'Instant',
      oracleText: 'Lightning Bolt deals 3 damage to any target.',
      colorIdentity: ['R'],
      colors: ['R'],
      legalities: { commander: 'legal', standard: 'not_legal', modern: 'legal' },
      oracleTags: ['burn'],
      artTags: ['lightning'],
      printingCount: 2,
    })
  })

  test("the printing identity attached is the card's most recent printing", async () => {
    const { body } = await details('name=Lightning%20Bolt')
    // Printings sort newest-first, and the seeded LEA copy is the older one.
    expect(body.card?.set).toBe('2xm')
    expect(body.card?.collectorNumber).toBe('129')
  })

  test('an unknown name is a 404 pointing at autocomplete', async () => {
    const { status, body } = await details('name=Not%20A%20Card')
    expect(status).toBe(404)
    expect(failure(body).card).toBeNull()
    expect(failure(body).message).toContain('/api/autocomplete')
  })

  test('a missing name is a 400', async () => {
    const { status, body } = await details('')
    expect(status).toBe(400)
    expect(failure(body).message).toBe('name is required.')
  })
})
