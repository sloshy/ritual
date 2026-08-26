import { describe, expect, test, mock, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { resetApiBase, setApiBase } from '../../../src/list-view/api-base'
import { defaultFinishForCard, resolveTradeFinish } from '../../../src/site/trade-finish'
import { encodeTradeToParams, hasTradeParams } from '../../../src/site/trade-url-encode'
import { normalizeCardName } from '../../../src/card/term-match'
import {
  decodeTradeFromParams,
  type TradeDecodeWarning,
  type TradeParamEntries,
} from '../../../src/site/trade-url-decode'
import type { TradeCardEntry } from '../../../src/list/site-data'
import type { TradeSearchEntry } from '../../../src/site/useTradeData'
import type { Finish } from '../../../src/card/finish-condition'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { makeScryfallCard } from '../../test-utils'

const noEntries: TradeParamEntries = {
  collectionEntries: [],
  deckEntries: [],
  wantedEntries: [],
}

function roundTrip(
  left: TradeCardEntry[],
  right: TradeCardEntry[],
  entries: TradeParamEntries = noEntries,
) {
  const params = encodeTradeToParams(left, right)
  return decodeTradeFromParams(params, entries, 'usd')
}

// decodeTradeFromParams prefetches scryfall cards for any `@sfId` in the URL
// that isn't already present in the supplied entries. Unit tests must never hit
// the network, so stub fetch to return an empty collection — none of these
// tests depend on the prefetched card (the rows under test either resolve from
// the provided entries or are intentionally empty because entries are stale).
const originalFetch = globalThis.fetch
function stubEmptyScryfallCollection(): void {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ data: [], not_found: [] }), { status: 200 })),
  ) as unknown as typeof fetch
}
beforeAll(stubEmptyScryfallCollection)
afterAll(() => {
  globalThis.fetch = originalFetch
})

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return makeScryfallCard({
    id: 'card-id-1',
    prices: {
      usd: '1.00',
      usd_foil: '5.00',
      usd_etched: '20.00',
      eur: '0.80',
      eur_foil: '4.50',
      tix: '0.05',
    },
    finishes: ['nonfoil', 'foil'],
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    rarity: 'rare',
    ...overrides,
  })
}

function makeSearchEntry(overrides: Partial<TradeSearchEntry> = {}): TradeSearchEntry {
  const scryfallCard = overrides.scryfallCard ?? makeCard()
  const name = scryfallCard?.name ?? 'Test Card'
  return {
    name,
    nameKey: normalizeCardName(name),
    scryfallCard,
    sourceName: 'Source',
    sourceKind: 'collection',
    maxQty: 1,
    cardIds: [1],
    ...overrides,
  }
}

describe('defaultFinishForCard', () => {
  test('prefers nonfoil over foil over etched', () => {
    expect(defaultFinishForCard(makeCard({ finishes: ['nonfoil', 'foil', 'etched'] }))).toBe(
      'nonfoil',
    )
    expect(defaultFinishForCard(makeCard({ finishes: ['foil', 'etched'] }))).toBe('foil')
    expect(defaultFinishForCard(makeCard({ finishes: ['etched'] }))).toBe('etched')
  })

  test('falls back to nonfoil when no recognized finish is present', () => {
    expect(defaultFinishForCard(makeCard({ finishes: ['glossy'] }))).toBe('nonfoil')
  })

  test('returns nonfoil when no scryfall card or no finishes', () => {
    expect(defaultFinishForCard(null)).toBe('nonfoil')
    expect(defaultFinishForCard(makeCard({ finishes: [] }))).toBe('nonfoil')
  })
})

describe('resolveTradeFinish', () => {
  test('returns requested finish when supported by the printing', () => {
    const card = makeCard({ finishes: ['nonfoil', 'foil'] })
    expect(resolveTradeFinish(card, 'foil')).toBe('foil')
  })

  test('falls back to default when requested finish is not available', () => {
    const card = makeCard({ finishes: ['nonfoil'] })
    expect(resolveTradeFinish(card, 'foil')).toBe('nonfoil')
  })

  test('falls back to default when no finish was requested', () => {
    const card = makeCard({ finishes: ['foil', 'etched'] })
    expect(resolveTradeFinish(card)).toBe('foil')
  })

  test('passes through requested finish when card has no finishes data', () => {
    expect(resolveTradeFinish(null, 'foil')).toBe('foil')
    expect(resolveTradeFinish(makeCard({ finishes: [] }), 'etched')).toBe('etched')
  })
})

describe('hasTradeParams', () => {
  test('true when any of the four trade params is present', () => {
    expect(hasTradeParams(new URLSearchParams('leftSideColIds=foo:1'))).toBe(true)
    expect(hasTradeParams(new URLSearchParams('leftSideDeckIds=foo:1x1'))).toBe(true)
    expect(hasTradeParams(new URLSearchParams('rightSideWantedIds=foo:1'))).toBe(true)
    expect(hasTradeParams(new URLSearchParams('rightSideScryfall=x1@abc'))).toBe(true)
  })

  test('false when none of the trade params is present', () => {
    expect(hasTradeParams(new URLSearchParams())).toBe(false)
    expect(hasTradeParams(new URLSearchParams('other=1'))).toBe(false)
  })
})

describe('encodeTradeToParams', () => {
  test('encodes collection cards as comma-separated IDs grouped by source', () => {
    const card = makeCard()
    const left: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: card,
        source: 'collection',
        sourceName: 'My Binder',
        qty: 2,
        sourceCardIds: [3, 7, 9],
      },
    ]
    const params = encodeTradeToParams(left, [])
    // qty=2 → only first 2 IDs encoded
    expect(params.get('leftSideColIds')).toBe('My%20Binder:3,7')
    expect(params.has('leftSideDeckIds')).toBe(false)
  })

  test('groups multiple collection sources with `|` and URL-encodes special chars', () => {
    const card = makeCard()
    const left: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: card,
        source: 'collection',
        sourceName: 'A&B|Pipes',
        qty: 1,
        sourceCardIds: [1],
      },
      {
        name: 'B',
        scryfallCard: card,
        source: 'collection',
        sourceName: 'Other',
        qty: 1,
        sourceCardIds: [4],
      },
    ]
    const value = encodeTradeToParams(left, []).get('leftSideColIds')
    expect(value).toBe('A%26B%7CPipes:1|Other:4')
  })

  test('skips collection cards that have no source IDs', () => {
    const left: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: makeCard(),
        source: 'collection',
        sourceName: 'My Binder',
        qty: 1,
        sourceCardIds: [],
      },
    ]
    expect(encodeTradeToParams(left, []).has('leftSideColIds')).toBe(false)
  })

  test('omits finish suffix when finish equals the printing default', () => {
    // Which finish counts as the default is pinned by the `defaultFinishForCard`
    // describe — here both a nonfoil-default and a foil-only (foil-default)
    // printing must encode without a `:finish` suffix.
    const entryFor = (card: ScryfallCard, finish: Finish): TradeCardEntry => ({
      name: 'A',
      scryfallCard: card,
      finish,
      source: 'deck',
      sourceName: 'Deck',
      qty: 1,
      editable: true,
      sourceCardIds: [5],
    })
    const nonfoilDefault = makeCard({ finishes: ['nonfoil', 'foil'] })
    expect(
      encodeTradeToParams([entryFor(nonfoilDefault, 'nonfoil')], []).get('leftSideDeckIds'),
    ).toBe(`Deck:5x1@${nonfoilDefault.id}`)

    const foilOnly = makeCard({ id: 'foil-only', finishes: ['foil'] })
    expect(encodeTradeToParams([entryFor(foilOnly, 'foil')], []).get('leftSideDeckIds')).toBe(
      'Deck:5x1@foil-only',
    )
  })

  test('includes :finish when finish is non-default', () => {
    const card = makeCard({ finishes: ['nonfoil', 'foil', 'etched'] })
    const left: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: card,
        finish: 'etched',
        source: 'deck',
        sourceName: 'Deck',
        qty: 1,
        editable: true,
        sourceCardIds: [5],
      },
    ]
    expect(encodeTradeToParams(left, []).get('leftSideDeckIds')).toBe(`Deck:5x1@${card.id}:etched`)
  })

  test('encodes scryfall-only cards on the right side', () => {
    const card = makeCard({ id: 'sf-1', finishes: ['nonfoil', 'foil'] })
    const right: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: card,
        finish: 'foil',
        source: 'scryfall',
        sourceName: 'Scryfall',
        qty: 3,
        editable: true,
      },
    ]
    expect(encodeTradeToParams([], right).get('rightSideScryfall')).toBe('x3@sf-1:foil')
  })
})

describe('decodeTradeFromParams — where a bare Scryfall ID is looked up', () => {
  const card = makeCard({ id: 'sf-1', name: 'Test Card' })
  const params = new URLSearchParams('rightSideScryfall=x1@sf-1')
  let requested: string[] = []

  beforeEach(() => {
    requested = []
    globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      requested.push(url)
      return url.includes('/api/cards')
        ? Response.json({ success: true, cards: [card] })
        : Response.json({ data: [card], not_found: [] })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    resetApiBase()
    stubEmptyScryfallCollection()
  })

  test('static site asks Scryfall, and the row says so', async () => {
    const decoded = await decodeTradeFromParams(params, noEntries, 'usd')

    expect(decoded.right[0]).toMatchObject({ source: 'scryfall', sourceName: 'Scryfall', qty: 1 })
    expect(requested.some((url) => url.includes('api.scryfall.com'))).toBeTrue()
  })

  test("hosted site asks the backend's cache, and the row says so", async () => {
    setApiBase('')

    const decoded = await decodeTradeFromParams(params, noEntries, 'usd')

    expect(decoded.right[0]).toMatchObject({ source: 'scryfall', sourceName: 'Cache' })
    expect(requested).toEqual(['/api/cards?ids=sf-1'])
  })
})

describe('language (~lang) in sf tokens', () => {
  const deckEntryFor = (card: ScryfallCard, cardIds = [11]): TradeSearchEntry =>
    makeSearchEntry({
      sourceName: 'Mono-W',
      sourceKind: 'deck',
      maxQty: 4,
      cardIds,
      scryfallCard: card,
    })

  test('encodes ~lang after the finish suffix, omitting it for English', () => {
    const card = makeCard({ id: 'deck-printing', finishes: ['nonfoil', 'foil'] })
    const entryFor = (overrides: Partial<TradeCardEntry>): TradeCardEntry => ({
      name: 'A',
      scryfallCard: card,
      source: 'deck',
      sourceName: 'Deck',
      qty: 1,
      editable: true,
      sourceCardIds: [5],
      ...overrides,
    })

    expect(
      encodeTradeToParams([entryFor({ language: 'ja', finish: 'foil' })], []).get(
        'leftSideDeckIds',
      ),
    ).toBe('Deck:5x1@deck-printing:foil~ja')
    expect(encodeTradeToParams([entryFor({ language: 'ja' })], []).get('leftSideDeckIds')).toBe(
      'Deck:5x1@deck-printing~ja',
    )
    // English — explicit or absent — encodes bare.
    expect(encodeTradeToParams([entryFor({ language: 'en' })], []).get('leftSideDeckIds')).toBe(
      'Deck:5x1@deck-printing',
    )
    expect(encodeTradeToParams([entryFor({})], []).get('leftSideDeckIds')).toBe(
      'Deck:5x1@deck-printing',
    )
  })

  test('a scryfall row encodes and decodes its language', async () => {
    const card = makeCard({ id: 'sf-row' })
    const right: TradeCardEntry[] = [
      {
        name: card.name,
        scryfallCard: card,
        language: 'ja',
        source: 'scryfall',
        sourceName: 'Scryfall',
        qty: 2,
      },
    ]
    const params = encodeTradeToParams([], right)
    expect(params.get('rightSideScryfall')).toBe('x2@sf-row~ja')

    const decoded = await decodeTradeFromParams(
      params,
      {
        ...noEntries,
        // The card resolves from the loaded entries' scryfall map.
        collectionEntries: [makeSearchEntry({ scryfallCard: card })],
      },
      'usd',
    )
    expect(decoded.right[0]).toMatchObject({ source: 'scryfall', qty: 2, language: 'ja' })
    expect(decoded.warnings).toEqual([])
  })

  test('a deck token round-trips its language alongside a non-default finish', async () => {
    const card = makeCard({ id: 'deck-printing', finishes: ['nonfoil', 'foil'] })
    const entry = deckEntryFor(card)
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        finish: 'foil',
        language: 'de',
        source: 'deck',
        sourceName: 'Mono-W',
        qty: 1,
        editable: true,
        sourceCardIds: [11],
      },
    ]
    const decoded = await roundTrip(left, [], { ...noEntries, deckEntries: [entry] })
    expect(decoded.left[0]).toMatchObject({ finish: 'foil', language: 'de' })
    expect(decoded.warnings).toEqual([])
  })

  test('a wanted token round-trips its language', async () => {
    const card = makeCard({ id: 'wanted-printing' })
    const entry = makeSearchEntry({
      sourceName: 'Wants',
      sourceKind: 'wanted',
      cardIds: [21],
      scryfallCard: card,
    })
    const right: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        language: 'zhs',
        source: 'wanted',
        sourceName: 'Wants',
        qty: 1,
        editable: true,
        sourceCardIds: [21],
      },
    ]
    const decoded = await roundTrip([], right, { ...noEntries, wantedEntries: [entry] })
    expect(decoded.right[0]).toMatchObject({ source: 'wanted', language: 'zhs' })
    expect(decoded.warnings).toEqual([])
  })

  test('a bad language code warns as a malformed token and decodes as English', async () => {
    const card = makeCard({ id: 'deck-printing' })
    const entry = deckEntryFor(card, [20])
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Mono-W:20x1@deck-printing~xx')
    const decoded = await decodeTradeFromParams(
      params,
      { ...noEntries, deckEntries: [entry] },
      'usd',
    )

    // The card survives — only the language suffix was bad — and the raw token
    // is carried in the warning, per the parser conventions.
    expect(decoded.left).toHaveLength(1)
    expect(decoded.left[0]?.language).toBeUndefined()
    expect(decoded.warnings).toEqual([{ kind: 'malformed-token', token: '20x1@deck-printing~xx' }])
  })

  test('an explicit ~en decodes to the bare spelling, warning nothing', async () => {
    const card = makeCard({ id: 'deck-printing' })
    const entry = deckEntryFor(card, [22])
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Mono-W:22x1@deck-printing~en')
    const decoded = await decodeTradeFromParams(
      params,
      { ...noEntries, deckEntries: [entry] },
      'usd',
    )

    expect(decoded.left[0]?.language).toBeUndefined()
    expect(decoded.warnings).toEqual([])
  })
})

describe('encode → decode round-trip', () => {
  test('collection cards round-trip with qty and source preserved', async () => {
    const card = makeCard()
    const entry = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      maxQty: 3,
      cardIds: [3, 7, 9],
    })
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        source: 'collection',
        sourceName: 'My Binder',
        qty: 2,
        sourceCardIds: [3, 7, 9],
      },
    ]
    const decoded = await roundTrip(left, [], { ...noEntries, collectionEntries: [entry] })
    expect(decoded.left).toHaveLength(1)
    expect(decoded.left[0]).toMatchObject({
      source: 'collection',
      sourceName: 'My Binder',
      qty: 2,
    })
    expect(decoded.right).toHaveLength(0)
  })

  test('deck card with editable printing round-trips, including non-default finish', async () => {
    const card = makeCard({ id: 'deck-printing', finishes: ['nonfoil', 'foil', 'etched'] })
    const entry = makeSearchEntry({
      sourceName: 'Mono-W',
      sourceKind: 'deck',
      maxQty: 4,
      cardIds: [11],
      scryfallCard: card,
    })
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        finish: 'etched',
        source: 'deck',
        sourceName: 'Mono-W',
        qty: 2,
        editable: true,
        sourceCardIds: [11],
      },
    ]
    const decoded = await roundTrip(left, [], { ...noEntries, deckEntries: [entry] })
    expect(decoded.left).toHaveLength(1)
    expect(decoded.left[0]).toMatchObject({
      source: 'deck',
      sourceName: 'Mono-W',
      finish: 'etched',
      qty: 2,
      editable: true,
    })
    expect(decoded.left[0]?.scryfallCard?.id).toBe('deck-printing')
  })

  test('foil-only deck card round-trips with no :foil in URL but resolves to foil', async () => {
    const card = makeCard({ id: 'foil-only', finishes: ['foil'] })
    const entry = makeSearchEntry({
      sourceName: 'Mono-W',
      sourceKind: 'deck',
      maxQty: 1,
      cardIds: [12],
      scryfallCard: card,
    })
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        finish: 'foil',
        source: 'deck',
        sourceName: 'Mono-W',
        qty: 1,
        editable: true,
        sourceCardIds: [12],
      },
    ]
    const decoded = await roundTrip(left, [], { ...noEntries, deckEntries: [entry] })
    expect(decoded.left[0]?.finish).toBe('foil')
    expect(decoded.left[0]?.price).toBe(5.0)
  })

  test('an invalid finish in the URL is dropped in favor of the printing default', async () => {
    const card = makeCard({ id: 'nf-only', finishes: ['nonfoil'] })
    const entry = makeSearchEntry({
      sourceName: 'Deck',
      sourceKind: 'deck',
      cardIds: [20],
      scryfallCard: card,
    })
    // Hand-crafted params containing :foil for a card that only has nonfoil
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Deck:20x1@nf-only:foil')
    const decoded = await decodeTradeFromParams(
      params,
      { ...noEntries, deckEntries: [entry] },
      'usd',
    )
    expect(decoded.left[0]?.finish).toBe('nonfoil')
  })

  test('decode picks the correct price field for the requested currency', async () => {
    const card = makeCard({ id: 'multi-price' })
    const entry = makeSearchEntry({
      sourceName: 'Deck',
      sourceKind: 'deck',
      cardIds: [30],
      scryfallCard: card,
    })
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        finish: 'foil',
        source: 'deck',
        sourceName: 'Deck',
        qty: 1,
        editable: true,
        sourceCardIds: [30],
      },
    ]
    const params = encodeTradeToParams(left, [])
    const deckOnly: TradeParamEntries = { ...noEntries, deckEntries: [entry] }
    const usd = await decodeTradeFromParams(params, deckOnly, 'usd')
    const eur = await decodeTradeFromParams(params, deckOnly, 'eur')
    expect(usd.left[0]?.price).toBe(5.0)
    expect(eur.left[0]?.price).toBe(4.5)
  })

  test('wanted card with editable printing round-trips with finish', async () => {
    const card = makeCard({ id: 'wanted-print', finishes: ['nonfoil', 'foil'] })
    const entry = makeSearchEntry({
      sourceName: 'Wishlist',
      sourceKind: 'wanted',
      maxQty: 2,
      cardIds: [40, 41],
    })
    const right: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        finish: 'foil',
        source: 'wanted',
        sourceName: 'Wishlist',
        qty: 2,
        sourceCardIds: [40, 41],
      },
    ]
    // entry has scryfallCard, so the decoder won't try to fetch it
    const decoded = await roundTrip([], right, {
      ...noEntries,
      wantedEntries: [{ ...entry, scryfallCard: card }],
    })
    expect(decoded.right).toHaveLength(1)
    expect(decoded.right[0]).toMatchObject({
      source: 'wanted',
      sourceName: 'Wishlist',
      qty: 2,
      finish: 'foil',
    })
    expect(decoded.right[0]?.price).toBe(5.0)
  })

  test('a wanted row keeps the printing that was picked, not the one wanted', async () => {
    // The list wants LEA:161; the trade was struck over the 2XM reprint.
    const wanted = makeCard({ id: 'wanted-lea', set: 'lea', collector_number: '161' })
    const picked = makeCard({ id: 'picked-2xm', set: '2xm', collector_number: '123' })
    const entry = makeSearchEntry({
      sourceName: 'Wishlist',
      sourceKind: 'wanted',
      scryfallCard: wanted,
      set: 'lea',
      collectorNumber: '161',
      maxQty: 1,
      cardIds: [40],
    })
    const right: TradeCardEntry[] = [
      {
        name: entry.name,
        set: picked.set,
        collectorNumber: picked.collector_number,
        scryfallCard: picked,
        source: 'wanted',
        sourceName: 'Wishlist',
        qty: 1,
        sourceCardIds: [40],
        editable: true,
      },
    ]

    const params = encodeTradeToParams([], right)
    expect(params.get('rightSideWantedIds')).toBe('Wishlist:40@picked-2xm')

    // The decoder only has the wanted list's own entry, so it must resolve the
    // picked printing from the URL's Scryfall ID.
    globalThis.fetch = (async (): Promise<Response> =>
      Response.json({ data: [picked], not_found: [] })) as unknown as typeof fetch
    try {
      const decoded = await decodeTradeFromParams(
        params,
        { ...noEntries, wantedEntries: [entry] },
        'usd',
      )
      expect(decoded.right[0]).toMatchObject({
        source: 'wanted',
        sourceName: 'Wishlist',
        set: '2xm',
        collectorNumber: '123',
        // Still re-editable after a restore, as it was before sharing.
        editable: true,
      })
      expect(decoded.right[0]?.scryfallCard?.id).toBe('picked-2xm')
    } finally {
      stubEmptyScryfallCollection()
    }
  })

  test('source names with URL-special characters round-trip intact', async () => {
    const card = makeCard()
    const entry = makeSearchEntry({
      sourceName: 'A & B | C, D:E',
      sourceKind: 'collection',
      maxQty: 1,
      cardIds: [99],
    })
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        source: 'collection',
        sourceName: 'A & B | C, D:E',
        qty: 1,
        sourceCardIds: [99],
      },
    ]
    const decoded = await roundTrip(left, [], { ...noEntries, collectionEntries: [entry] })
    expect(decoded.left).toHaveLength(1)
    expect(decoded.left[0]?.sourceName).toBe('A & B | C, D:E')
  })
})

describe('decodeTradeFromParams — URL-decode race / stale-entry coverage', () => {
  // Regression coverage for the gating effect at TradePage.tsx that waits on
  // `decksReady`/`initialReady` before decoding URL params. If the gate is ever
  // weakened (or §3.1/§3.2 collapse the state machine incorrectly), decode will
  // run against not-yet-loaded entries — these tests pin down the
  // currently-relied-upon silent-skip behavior so a regression is visible.

  test('collection + deck on left side: only collection decoded when deckEntries unloaded', async () => {
    const card = makeCard()
    const collectionEntry = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      maxQty: 1,
      cardIds: [3],
    })
    const left: TradeCardEntry[] = [
      {
        name: collectionEntry.name,
        scryfallCard: card,
        source: 'collection',
        sourceName: 'My Binder',
        qty: 1,
        sourceCardIds: [3],
      },
      {
        name: 'Deck Card',
        scryfallCard: card,
        source: 'deck',
        sourceName: 'Mono-W',
        qty: 1,
        editable: true,
        sourceCardIds: [11],
      },
    ]
    // deckEntries empty — simulates a decode kicked off before useTradeData.loadDecks finished
    const decoded = await roundTrip(left, [], {
      ...noEntries,
      collectionEntries: [collectionEntry],
    })
    expect(decoded.left).toHaveLength(1)
    expect(decoded.left[0]).toMatchObject({ source: 'collection', sourceName: 'My Binder' })
  })

  test('source name in URL not present in entries surfaces unknown-source warning', async () => {
    const entry = makeSearchEntry({
      sourceName: 'Renamed',
      sourceKind: 'collection',
      maxQty: 1,
      cardIds: [3],
    })
    const params = new URLSearchParams()
    params.set('leftSideColIds', 'Old%20Name:3') // URL still references the old source name

    const decoded = await decodeTradeFromParams(
      params,
      { ...noEntries, collectionEntries: [entry] },
      'usd',
    )
    expect(decoded.left).toHaveLength(0)
    expect(decoded.warnings).toContainEqual({
      kind: 'unknown-source',
      sourceKind: 'collection',
      sourceName: 'Old Name',
    })
  })

  test('partially valid URL: known IDs decode, unknown IDs in same source emit warning', async () => {
    const card = makeCard()
    const entry = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      maxQty: 2,
      cardIds: [3, 7],
      scryfallCard: card,
    })
    const params = new URLSearchParams()
    params.set('leftSideColIds', 'My%20Binder:3,999,7') // 3 and 7 valid, 999 deleted

    const decoded = await decodeTradeFromParams(
      params,
      { ...noEntries, collectionEntries: [entry] },
      'usd',
    )
    // The two valid IDs collapse to a single qty=2 row
    expect(decoded.left).toHaveLength(1)
    expect(decoded.left[0]?.qty).toBe(2)
    expect(decoded.left[0]?.sourceCardIds).toEqual([3, 7])
    expect(decoded.warnings).toContainEqual({
      kind: 'unknown-card-ids',
      sourceKind: 'collection',
      sourceName: 'My Binder',
      ids: [999],
    })
  })

  test('a successful decode reports no warnings', async () => {
    const card = makeCard()
    const entry = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      maxQty: 1,
      cardIds: [3],
      scryfallCard: card,
    })
    const params = new URLSearchParams()
    params.set('leftSideColIds', 'My%20Binder:3')

    const decoded = await decodeTradeFromParams(
      params,
      { ...noEntries, collectionEntries: [entry] },
      'usd',
    )
    expect(decoded.left).toHaveLength(1)
    expect(decoded.warnings).toEqual([])
  })

  test('two-phase decode: same params yield empty result pre-load, populated result post-load', async () => {
    const params = new URLSearchParams('leftSideDeckIds=Mono-W:11x1@some-sf-id')

    // First call (decks not ready, entries empty): empty result, no throw
    const early = await decodeTradeFromParams(params, noEntries, 'usd')
    expect(early.left).toHaveLength(0)

    // Same params, entries now populated (post-load): decoded
    const card = makeCard({ id: 'some-sf-id' })
    const entry = makeSearchEntry({
      sourceName: 'Mono-W',
      sourceKind: 'deck',
      maxQty: 1,
      cardIds: [11],
      scryfallCard: card,
    })
    const ready = await decodeTradeFromParams(params, { ...noEntries, deckEntries: [entry] }, 'usd')
    expect(ready.left).toHaveLength(1)
    expect(ready.left[0]).toMatchObject({ source: 'deck', sourceName: 'Mono-W' })
  })

  // Every warning case shares one skeleton: set a single param, decode against
  // the given entries, and expect the structured warning (plus an empty side
  // where the bad token drops the row). Each row exercises a distinct branch in
  // decodeCollectionParam/decodeDeckParam/decodeWantedParam/decodeScryfallParam
  // — structured parser errors are a project invariant, so every case is kept.
  type DecodeWarningCase = {
    name: string
    paramKey: 'leftSideColIds' | 'leftSideDeckIds' | 'rightSideWantedIds' | 'rightSideScryfall'
    paramValue: string
    entries: TradeParamEntries
    expectedWarning: TradeDecodeWarning
    /** Side asserted to decode to zero rows; null when the case only pins the warning. */
    emptySide: 'left' | 'right' | null
  }

  const warningCases: DecodeWarningCase[] = [
    {
      name: 'malformed scryfall token is reported but does not abort decode',
      paramKey: 'rightSideScryfall',
      paramValue: 'not-a-token',
      entries: noEntries,
      expectedWarning: { kind: 'malformed-token', token: 'not-a-token' },
      emptySide: 'right',
    },
    {
      // URL references id 999 (no longer in the pool) with a valid scryfall suffix
      name: 'deck source: card ID in URL not present in source pool surfaces unknown-card-ids warning',
      paramKey: 'leftSideDeckIds',
      paramValue: 'Mono-W:999x1@deck-sf-id',
      entries: {
        ...noEntries,
        deckEntries: [
          makeSearchEntry({
            sourceName: 'Mono-W',
            sourceKind: 'deck',
            maxQty: 1,
            cardIds: [11], // pool contains 11 only
            scryfallCard: makeCard({ id: 'deck-sf-id' }),
          }),
        ],
      },
      expectedWarning: {
        kind: 'unknown-card-ids',
        sourceKind: 'deck',
        sourceName: 'Mono-W',
        ids: [999],
      },
      emptySide: 'left',
    },
    {
      // URL references id 999 (no longer in the pool) with a valid scryfall suffix
      name: 'wanted source: card ID in URL not present in source pool surfaces unknown-card-ids warning',
      paramKey: 'rightSideWantedIds',
      paramValue: 'Wishlist:999@wanted-sf-id',
      entries: {
        ...noEntries,
        wantedEntries: [
          makeSearchEntry({
            sourceName: 'Wishlist',
            sourceKind: 'wanted',
            maxQty: 1,
            cardIds: [40], // pool contains 40 only
            scryfallCard: makeCard({ id: 'wanted-sf-id' }),
          }),
        ],
      },
      expectedWarning: {
        kind: 'unknown-card-ids',
        sourceKind: 'wanted',
        sourceName: 'Wishlist',
        ids: [999],
      },
      emptySide: 'right',
    },
    {
      // The id exists in the local pool, but the @sfId suffix points to a printing
      // that is not present in any entry and not returned by the (mocked) fetch.
      name: "deck token referencing a scryfall id the fetch stub can't resolve surfaces unknown-scryfall-id",
      paramKey: 'leftSideDeckIds',
      paramValue: 'Mono-W:11x1@nonexistent-id',
      entries: {
        ...noEntries,
        deckEntries: [
          makeSearchEntry({
            sourceName: 'Mono-W',
            sourceKind: 'deck',
            maxQty: 1,
            cardIds: [11],
            scryfallCard: null,
          }),
        ],
      },
      expectedWarning: { kind: 'unknown-scryfall-id', sfId: 'nonexistent-id' },
      emptySide: null,
    },
    {
      name: 'scryfall-only param referencing an unresolvable id surfaces unknown-scryfall-id',
      paramKey: 'rightSideScryfall',
      paramValue: 'x1@nonexistent-id',
      entries: noEntries,
      expectedWarning: { kind: 'unknown-scryfall-id', sfId: 'nonexistent-id' },
      emptySide: 'right',
    },
    {
      // `decodeWantedParam` shares the `@sfId` lookup with the deck/scryfall paths
      // through `parseSfPart`, but is decoded by a different branch — pin the
      // warning here independently so a regression in the wanted branch isn't
      // hidden by the deck/scryfall coverage above. Wanted is decoded only from
      // the right-side param, and the wanted-token base is a bare `<id>` (not
      // `<id>x<qty>` like deck tokens).
      name: "wanted token referencing a scryfall id the fetch stub can't resolve surfaces unknown-scryfall-id",
      paramKey: 'rightSideWantedIds',
      paramValue: 'Wishlist:22@nonexistent-id',
      entries: {
        ...noEntries,
        wantedEntries: [
          makeSearchEntry({
            sourceName: 'Wishlist',
            sourceKind: 'wanted',
            maxQty: 1,
            cardIds: [22],
            scryfallCard: null,
          }),
        ],
      },
      expectedWarning: { kind: 'unknown-scryfall-id', sfId: 'nonexistent-id' },
      emptySide: null,
    },
    {
      // `badtoken` is missing the required `<id>x<qty>` separator
      name: 'deck grouped param with a malformed token surfaces malformed-token warning',
      paramKey: 'leftSideDeckIds',
      paramValue: 'Mono-W:badtoken',
      entries: {
        ...noEntries,
        deckEntries: [
          makeSearchEntry({ sourceName: 'Mono-W', sourceKind: 'deck', maxQty: 1, cardIds: [11] }),
        ],
      },
      expectedWarning: { kind: 'malformed-token', token: 'badtoken' },
      emptySide: 'left',
    },
    {
      // `badtoken` is not a valid numeric ID
      name: 'collection grouped param with a malformed token surfaces malformed-token warning',
      paramKey: 'leftSideColIds',
      paramValue: 'My%20Binder:badtoken',
      entries: {
        ...noEntries,
        collectionEntries: [
          makeSearchEntry({
            sourceName: 'My Binder',
            sourceKind: 'collection',
            maxQty: 1,
            cardIds: [3],
          }),
        ],
      },
      expectedWarning: { kind: 'malformed-token', token: 'badtoken' },
      emptySide: 'left',
    },
  ]

  for (const warningCase of warningCases) {
    test(warningCase.name, async () => {
      const params = new URLSearchParams()
      params.set(warningCase.paramKey, warningCase.paramValue)

      const decoded = await decodeTradeFromParams(params, warningCase.entries, 'usd')
      if (warningCase.emptySide) {
        expect(decoded[warningCase.emptySide]).toHaveLength(0)
      }
      expect(decoded.warnings).toContainEqual(warningCase.expectedWarning)
    })
  }
})

describe('decode — labels re-resolved from the loaded entries', () => {
  test('a decoded collection row carries its entry labels, so the KEEP tag survives a shared URL', async () => {
    const card = makeCard()
    const entry = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      labels: ['keep'],
      maxQty: 1,
      cardIds: [3],
    })
    const left: TradeCardEntry[] = [
      {
        name: entry.name,
        scryfallCard: card,
        source: 'collection',
        sourceName: 'My Binder',
        qty: 1,
        sourceCardIds: [3],
      },
    ]
    const decoded = await roundTrip(left, [], { ...noEntries, collectionEntries: [entry] })
    expect(decoded.left[0]!.labels).toEqual(['keep'])
  })

  test('a decoded row that carries no price by rule is re-decoded at nothing', async () => {
    const card = makeCard({
      prices: {
        usd: '9.99',
        usd_foil: null,
        usd_etched: null,
        eur: null,
        eur_foil: null,
        tix: null,
      },
    })
    const proxy = makeSearchEntry({
      sourceName: 'My Deck',
      sourceKind: 'deck',
      scryfallCard: card,
      labels: ['proxy'],
      price: 9.99,
      maxQty: 1,
      cardIds: [3],
    })
    const custom = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      scryfallCard: card,
      customArt: 'art/sol-ring.jpg',
      price: 9.99,
      maxQty: 1,
      cardIds: [4],
    })
    const row = (entry: TradeSearchEntry, source: 'deck' | 'collection'): TradeCardEntry => ({
      name: entry.name,
      scryfallCard: card,
      source,
      sourceName: entry.sourceName,
      qty: 1,
      sourceCardIds: entry.cardIds,
    })

    const decoded = await roundTrip([row(proxy, 'deck'), row(custom, 'collection')], [], {
      ...noEntries,
      deckEntries: [proxy],
      collectionEntries: [custom],
    })

    // Both sides of the rule survive the URL: the board totals them as nothing.
    expect(decoded.left.map((c) => c.price)).toEqual([0, 0])
    expect(decoded.left.find((c) => c.source === 'deck')?.labels).toEqual(['proxy'])
    expect(decoded.left.find((c) => c.source === 'collection')?.customArt).toBe('art/sol-ring.jpg')
  })
})
