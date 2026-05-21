import { describe, expect, test, mock, beforeAll, afterAll } from 'bun:test'
import { defaultFinishForCard, resolveTradeFinish } from '../../../src/site/trade-finish'
import { encodeTradeToParams, hasTradeParams } from '../../../src/site/trade-url-encode'
import { decodeTradeFromParams } from '../../../src/site/trade-url-decode'
import type { TradeCardEntry } from '../../../src/site/data-types'
import type { TradeSearchEntry } from '../../../src/site/useTradeData'
import type { ScryfallCard } from '../../../src/types'

// decodeTradeFromParams prefetches scryfall cards for any `@sfId` in the URL
// that isn't already present in the supplied entries. Unit tests must never hit
// the network, so stub fetch to return an empty collection — none of these
// tests depend on the prefetched card (the rows under test either resolve from
// the provided entries or are intentionally empty because entries are stale).
const originalFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ data: [], not_found: [] }), { status: 200 })),
  ) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'card-id-1',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    prices: {
      usd: '1.00',
      usd_foil: '5.00',
      usd_etched: '20.00',
      eur: '0.80',
      eur_foil: '4.50',
      tix: '0.05',
    },
    finishes: ['nonfoil', 'foil'],
    games: ['paper'],
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '1',
    rarity: 'rare',
    color_identity: [],
    ...overrides,
  }
}

function makeSearchEntry(overrides: Partial<TradeSearchEntry> = {}): TradeSearchEntry {
  const scryfallCard = overrides.scryfallCard ?? makeCard()
  const name = scryfallCard?.name ?? 'Test Card'
  return {
    name,
    nameLower: name.toLowerCase(),
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

  test('omits :finish when finish equals the card default (nonfoil)', () => {
    const card = makeCard({ finishes: ['nonfoil', 'foil'] })
    const left: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: card,
        finish: 'nonfoil',
        source: 'deck',
        sourceName: 'Deck',
        qty: 1,
        editable: true,
        sourceCardIds: [5],
      },
    ]
    expect(encodeTradeToParams(left, []).get('leftSideDeckIds')).toBe(`Deck:5x1@${card.id}`)
  })

  test('omits :foil when foil is the only finish (default for foil-only printings)', () => {
    const card = makeCard({ id: 'foil-only', finishes: ['foil'] })
    const left: TradeCardEntry[] = [
      {
        name: 'A',
        scryfallCard: card,
        finish: 'foil',
        source: 'deck',
        sourceName: 'Deck',
        qty: 1,
        editable: true,
        sourceCardIds: [5],
      },
    ]
    expect(encodeTradeToParams(left, []).get('leftSideDeckIds')).toBe('Deck:5x1@foil-only')
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
    const params = encodeTradeToParams(left, [])
    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [entry], deckEntries: [], wantedEntries: [] },
      'usd',
    )
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
    const params = encodeTradeToParams(left, [])
    expect(params.get('leftSideDeckIds')).toContain(':etched')

    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [entry], wantedEntries: [] },
      'usd',
    )
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
    const params = encodeTradeToParams(left, [])
    expect(params.get('leftSideDeckIds')).toBe('Mono-W:12x1@foil-only')

    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [entry], wantedEntries: [] },
      'usd',
    )
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
      { collectionEntries: [], deckEntries: [entry], wantedEntries: [] },
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
    const usd = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [entry], wantedEntries: [] },
      'usd',
    )
    const eur = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [entry], wantedEntries: [] },
      'eur',
    )
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
    const params = encodeTradeToParams([], right)
    const decoded = await decodeTradeFromParams(
      params,
      {
        collectionEntries: [],
        deckEntries: [],
        // entry has scryfallCard, so the decoder won't try to fetch it
        wantedEntries: [{ ...entry, scryfallCard: card }],
      },
      'usd',
    )
    expect(decoded.right).toHaveLength(1)
    expect(decoded.right[0]).toMatchObject({
      source: 'wanted',
      sourceName: 'Wishlist',
      qty: 2,
      finish: 'foil',
    })
    expect(decoded.right[0]?.price).toBe(5.0)
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
    const params = encodeTradeToParams(left, [])
    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [entry], deckEntries: [], wantedEntries: [] },
      'usd',
    )
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

  test('deck params with empty deckEntries produces an empty deck side (premature decode)', async () => {
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Mono-W:11x1@some-sf-id')
    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [], wantedEntries: [] },
      'usd',
    )
    expect(decoded.left).toHaveLength(0)
    expect(decoded.right).toHaveLength(0)
  })

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
    const params = encodeTradeToParams(left, [])
    expect(params.has('leftSideColIds')).toBe(true)
    expect(params.has('leftSideDeckIds')).toBe(true)

    // deckEntries empty — simulates a decode kicked off before useTradeData.loadDecks finished
    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [collectionEntry], deckEntries: [], wantedEntries: [] },
      'usd',
    )
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
      { collectionEntries: [entry], deckEntries: [], wantedEntries: [] },
      'usd',
    )
    expect(decoded.left).toHaveLength(0)
    expect(decoded.warnings).toContainEqual({
      kind: 'unknown-source',
      sourceKind: 'collection',
      sourceName: 'Old Name',
    })
  })

  test('card ID in URL not present in source pool surfaces unknown-card-ids warning', async () => {
    const entry = makeSearchEntry({
      sourceName: 'My Binder',
      sourceKind: 'collection',
      maxQty: 1,
      cardIds: [3], // pool contains 3 only
    })
    const params = new URLSearchParams()
    params.set('leftSideColIds', 'My%20Binder:999') // URL references id 999, no longer in pool

    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [entry], deckEntries: [], wantedEntries: [] },
      'usd',
    )
    expect(decoded.left).toHaveLength(0)
    expect(decoded.warnings).toContainEqual({
      kind: 'unknown-card-ids',
      sourceKind: 'collection',
      sourceName: 'My Binder',
      ids: [999],
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
      { collectionEntries: [entry], deckEntries: [], wantedEntries: [] },
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
      { collectionEntries: [entry], deckEntries: [], wantedEntries: [] },
      'usd',
    )
    expect(decoded.left).toHaveLength(1)
    expect(decoded.warnings).toEqual([])
  })

  test('malformed scryfall token is reported but does not abort decode', async () => {
    const params = new URLSearchParams()
    params.set('rightSideScryfall', 'not-a-token')

    const decoded = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [], wantedEntries: [] },
      'usd',
    )
    expect(decoded.right).toHaveLength(0)
    expect(decoded.warnings).toContainEqual({ kind: 'malformed-token', token: 'not-a-token' })
  })

  test('hasTradeParams stays true even when entries are stale, so the gate fires once data loads', async () => {
    // The gating effect uses hasTradeParams + decksReady to know when it's safe to decode.
    // A URL with deck params should still report hasTradeParams=true regardless of
    // what entries are loaded — that signal must be entry-independent.
    const params = new URLSearchParams('leftSideDeckIds=Mono-W:11x1@some-sf-id')
    expect(hasTradeParams(params)).toBe(true)

    // First call (decks not ready, entries empty): empty result, no throw
    const early = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [], wantedEntries: [] },
      'usd',
    )
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
    const ready = await decodeTradeFromParams(
      params,
      { collectionEntries: [], deckEntries: [entry], wantedEntries: [] },
      'usd',
    )
    expect(ready.left).toHaveLength(1)
    expect(ready.left[0]).toMatchObject({ source: 'deck', sourceName: 'Mono-W' })
  })
})
