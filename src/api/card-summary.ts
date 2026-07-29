import type { ScryfallCard } from '../types'

/**
 * The one home for every agent-facing projection of a Scryfall card.
 *
 * The cached `ScryfallCard` carries image URLs, per-face image blocks, and other
 * payload no API client needs; these projections are what the card routes
 * (`/api/card-details`, `/api/card-search`, `/api/search-cards`) and the MCP
 * tools built over them return instead. Keeping them here means the printing
 * shape the price tools read and the card shape the search routes emit can never
 * drift apart.
 *
 * Set codes are echoed **lowercase**, normalized here rather than assumed:
 * cache-backed callers arrive pre-lowercased via `mapScryfallCard`, but
 * `/api/card-search` projects raw Scryfall JSON that never passed through it.
 * Uppercasing is a display concern and belongs to the caller.
 */

/** The Scryfall price block, as the cache stores it. */
export type CardPrices = ScryfallCard['prices']

/** Printing identity + prices: the lean projection the price tools use. */
export interface PrintingSummary {
  scryfallId: string
  name: string
  /** Lowercase set code. */
  set: string
  collectorNumber: string
  rarity: string
  /** Absent on the rare printing Scryfall reports without a release date. */
  releasedAt?: string
  finishes: string[]
  prices: CardPrices
}

/** A printing plus the oracle-level fields that make a search result actionable. */
export interface CardSummary extends PrintingSummary {
  manaCost?: string
  cmc?: number
  typeLine?: string
  oracleText?: string
  colorIdentity?: string[]
}

/** One face of a multi-faced card. */
export interface CardFaceSummary {
  name: string
  manaCost?: string
  typeLine?: string
  oracleText?: string
}

/** Everything `GET /api/card-details` reports about a card. */
export interface CardDetails extends CardSummary {
  layout?: string
  /** Mana colors (WUBRG letters). Distinct from {@link CardSummary.colorIdentity}. */
  colors?: string[]
  keywords?: string[]
  /** Scryfall format→status map (`legal`/`not_legal`/`banned`/`restricted`). */
  legalities?: Record<string, string>
  oracleTags?: string[]
  artTags?: string[]
  faces?: CardFaceSummary[]
  /** How many printings of this card the cache (or Scryfall) reported. */
  printingCount: number
}

/** Project a full Scryfall card to printing identity + prices, dropping image URLs etc. */
export function summarizePrinting(card: ScryfallCard): PrintingSummary {
  return {
    scryfallId: card.id,
    name: card.name,
    // Normalized here, not assumed: raw Scryfall JSON (which `/api/card-search`
    // projects directly) uppercases some set codes, and the contract is lowercase.
    set: card.set.toLowerCase(),
    collectorNumber: card.collector_number,
    rarity: card.rarity,
    releasedAt: card.released_at,
    finishes: card.finishes,
    prices: card.prices,
  }
}

/** {@link summarizePrinting} over a nullable card, for the price tools' optional prints. */
export function summarizePrintingOrNull(card: ScryfallCard | null): PrintingSummary | null {
  return card === null ? null : summarizePrinting(card)
}

/** {@link summarizePrinting} plus the oracle-level fields a search result needs. */
export function summarizeCard(card: ScryfallCard): CardSummary {
  return {
    ...summarizePrinting(card),
    manaCost: card.mana_cost,
    cmc: card.cmc,
    typeLine: card.type_line,
    oracleText: card.oracle_text,
    colorIdentity: card.color_identity,
  }
}

/** Project one face of a multi-faced card. */
function summarizeFace(face: NonNullable<ScryfallCard['card_faces']>[number]): CardFaceSummary {
  return {
    name: face.name,
    manaCost: face.mana_cost,
    typeLine: face.type_line,
    oracleText: face.oracle_text,
  }
}

/**
 * The full card report: {@link summarizeCard} plus colors, keywords, format
 * legalities, Scryfall Tagger tags, and the card's faces. `printingCount` is
 * how many printings the caller found — the projection never counts them itself.
 */
export function detailCard(card: ScryfallCard, printingCount: number): CardDetails {
  return {
    ...summarizeCard(card),
    layout: card.layout,
    colors: card.colors,
    keywords: card.keywords,
    legalities: card.legalities,
    oracleTags: card.oracleTags,
    artTags: card.artTags,
    faces: card.card_faces?.map(summarizeFace),
    printingCount,
  }
}
