/**
 * Card-shaped fixtures, free of `bun:test` and of any runtime `src/cache`
 * import — so the Playwright helpers (a plain Node process) and the Bun suites
 * can share one definition. `test/test-utils.ts` re-exports everything here, so
 * a Bun suite keeps importing from there.
 */

import type { ScryfallCard } from '../../src/scryfall/types'
import type { CardData } from '../../src/list-view/card-sorting'
import type { CardContextInfo } from '../../src/list-view/card-context'
import type { SelectedCard } from '../../src/list-view/useCardSelection'
import type { CardKingdomCacheFile, CardKingdomProduct } from '../../src/cardkingdom'
import type { PrintingQuoteFn, QuotePrinting } from '../../src/cardkingdom/quote'
import type { BuylistQuote } from '../../src/buylist'
import { displayLanguage } from '../../src/card/card-language'

/** Overrides for {@link makeScryfallCard}. `prices` may be partial; it is merged over all-null defaults. */
type ScryfallCardOverrides = Partial<Omit<ScryfallCard, 'prices'>> & {
  prices?: Partial<ScryfallCard['prices']>
}

/** A minimal valid ScryfallCard with neutral defaults. Override any field; partial `prices` are merged. */
export function makeScryfallCard(overrides: ScryfallCardOverrides = {}): ScryfallCard {
  const { prices, ...rest } = overrides
  return {
    id: 'test-id',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
    ...rest,
    prices: {
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      // No `eur_etched` default: the ingest mapper omits the field when
      // Scryfall does (which is almost always), so fixtures mirror that.
      tix: null,
      ...prices,
    },
  }
}

/**
 * A cached printing of one card at `set:collectorNumber`, optionally in a
 * specific language (`lang` omitted models a `default_cards` object, which
 * counts as English). The shared fixture for suites exercising printing
 * identity/language resolution (`findPrinting`, `printingLanguages`,
 * `resolvePrintingLanguage`, the editors' printing-key maps).
 */
export function makePrintingIn(set: string, collectorNumber: string, lang?: string): ScryfallCard {
  return makeScryfallCard({
    id: `${set}-${collectorNumber}${lang ? `-${lang}` : ''}`,
    name: 'Lightning Bolt',
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    ...(lang !== undefined ? { lang } : {}),
  })
}

/** A context-menu / bulk-edit target: one name-only copy unless overridden. */
export function makeContextInfo(
  overrides: Partial<CardContextInfo> & { cardName: string },
): CardContextInfo {
  return { card: null, cardIds: [], quantity: 1, ...overrides }
}

/** A multi-select tile: one deck copy of a name-only card unless overridden. */
export function makeSelectedCard(
  overrides: Partial<SelectedCard> & { name: string },
): SelectedCard {
  return {
    key: overrides.name,
    quantity: 1,
    groupSize: 1,
    scryfallCard: null,
    sourceName: 'Test',
    sourceKind: 'deck',
    maxQty: 1,
    cardIds: [],
    ...overrides,
  }
}

/** A CardData tile with neutral defaults for site sorting/filtering tests. */
export function makeCardData(overrides: Partial<CardData> = {}): CardData {
  return {
    name: 'Test Card',
    quantity: 1,
    cmc: 3,
    edhrec: 1000,
    price: 1.5,
    buylistPrice: 0,
    buylistSpread: 0,
    onBuylist: false,
    type: 'Creature — Human',
    section: 'Main',
    fileOrder: 0,
    setCode: 'tst',
    colorIdentity: [],
    hasPrinting: true,
    oracleTags: [],
    artTags: [],
    labels: [],
    card: null,
    ...overrides,
  }
}

// ── Card Kingdom ───────────────────────────────────────────────────────────

/** A parsed Card Kingdom feed product with neutral defaults, for sell fixtures. */
export function makeCardKingdomProduct(
  overrides: Partial<CardKingdomProduct> = {},
): CardKingdomProduct {
  return {
    id: 1,
    sku: 'TST-0001',
    scryfallId: 'sf-1',
    url: 'mtg/test-set/test-card',
    name: 'Test Card',
    variation: '',
    edition: 'Test Set',
    finish: 'nonfoil',
    priceRetail: 1,
    qtyRetail: 5,
    priceBuy: 0.5,
    qtyBuying: 10,
    ...overrides,
  }
}

/**
 * One buyer quote as a detail bakes it and the store seeds it, with neutral
 * defaults.
 *
 * `BuylistQuote` is the wire type the bake and the client store both key their
 * behavior on, so it gets one fixture.
 */
export function makeBuylistQuote(overrides: Partial<BuylistQuote> = {}): BuylistQuote {
  return {
    priceBuy: 4,
    qtyBuying: 2,
    priceRetail: 8,
    qtyRetail: 3,
    buying: true,
    finish: 'nonfoil',
    matchVia: 'scryfall-id',
    productId: 1,
    name: 'Test Card',
    edition: 'Test Set',
    ...overrides,
  }
}

/** A {@link ckRetailQuote} lookup, with the printings it was asked about. */
type StubCardKingdomQuote = PrintingQuoteFn & { asked: QuotePrinting[] }

/**
 * A Card Kingdom lookup over a fixed retail table keyed `set:collectorNumber:finish`
 * — the one stub for every test that needs CK to carry some printings and not
 * others. Refuses non-English requests through the same `displayLanguage` rule
 * the real matcher applies, so a test of that rule cannot pass against a
 * hand-rolled approximation of it.
 *
 * `asked` records every printing the code under test priced, which is how a
 * test pins *which* printing was selected rather than only what came back.
 */
export function ckRetailQuote(retail: Record<string, number>): StubCardKingdomQuote {
  const asked: QuotePrinting[] = []
  const quote: StubCardKingdomQuote = Object.assign(
    (printing: QuotePrinting) => {
      asked.push(printing)
      if (displayLanguage(printing.language) !== 'en') return null
      const price = retail[`${printing.set}:${printing.collectorNumber}:${printing.finish}`]
      if (price === undefined) return null
      return makeBuylistQuote({ priceRetail: price, finish: printing.finish })
    },
    { asked },
  )
  return quote
}

/**
 * A raw pricelist payload as Card Kingdom serves it — string-encoded bools and
 * prices — built from the parsed products the fixtures already speak in. For
 * suites that stub the download rather than the cache file.
 *
 * `is_foil` is derived from the product's finish, so an `etched` fixture also
 * needs an "Etched" `variation` for the parser to read it back as etched.
 *
 * `createdAt` is the buyer's own generation stamp: a suite that has to tell a
 * downloaded feed from the cached one passes a different one than
 * {@link makeCardKingdomCacheFile}'s.
 */
export function cardKingdomFeedBody(
  products: CardKingdomProduct[] = [makeCardKingdomProduct()],
  createdAt = '2026-08-04 06:06:09',
): Record<string, unknown> {
  return {
    meta: { created_at: createdAt, base_url: 'https://www.cardkingdom.com/' },
    data: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      scryfall_id: product.scryfallId,
      url: product.url,
      name: product.name,
      variation: product.variation,
      edition: product.edition,
      is_foil: product.finish === 'nonfoil' ? 'false' : 'true',
      price_retail: product.priceRetail.toFixed(2),
      qty_retail: 3,
      price_buy: product.priceBuy.toFixed(2),
      qty_buying: product.qtyBuying,
    })),
  }
}

/** A persisted Card Kingdom cache file wrapping `products`, stamped `retrievedAt`. */
export function makeCardKingdomCacheFile(
  products: CardKingdomProduct[],
  retrievedAt = Date.now(),
): CardKingdomCacheFile {
  return {
    retrievedAt,
    feed: {
      createdAt: '2026-08-04 06:06:09',
      baseUrl: 'https://www.cardkingdom.com/',
      products,
    },
  }
}
