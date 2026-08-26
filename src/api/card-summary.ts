import type { ScryfallCard } from '../scryfall/types'

/**
 * The one home for every agent-facing projection of a Scryfall card.
 *
 * The cached `ScryfallCard` carries image URLs, per-face image blocks, and other
 * payload no API client needs; these projections are what the card routes
 * (`/api/card-details`, `/api/card-search`, `/api/card-printings`) and the MCP
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

/**
 * Which printing this is, without its price block — the projection a client
 * that is choosing between printings wants, since the price block is roughly
 * half a printing's bytes and means nothing to that decision.
 */
export interface PrintingIdentity {
  scryfallId: string
  name: string
  /** Lowercase set code. */
  set: string
  collectorNumber: string
  rarity: string
  /** Absent on the rare printing Scryfall reports without a release date. */
  releasedAt?: string
  finishes: string[]
  /**
   * Scryfall language code of this card object; **absent means English**
   * (`en`), matching how the cache stores `ScryfallCard.lang`. With an
   * `all_cards`-backed cache the same set:collectorNumber can appear once per
   * language.
   */
  lang?: string
}

/** Printing identity + prices: the lean projection the price tools use. */
export interface PrintingSummary extends PrintingIdentity {
  prices: CardPrices
}

/**
 * One printing in a *list* of them, where prices ride along only if the caller
 * asked for them (`get_card_printings`' `includePrices`). The union of the two
 * projections above, and the honest element type for that response: describing
 * it as bare {@link PrintingIdentity} told a caller the prices it explicitly
 * requested were not there.
 */
export type PrintingListing = PrintingIdentity & { prices?: CardPrices }

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
  /**
   * Whether {@link printingCount} is the card's real printing total. False when
   * the local card cache holds no bulk-downloaded entry for the name: the count
   * is then whatever a single Scryfall lookup returned (always 1).
   */
  printingsComplete: boolean
}

/** Project a full Scryfall card to printing identity alone, dropping prices and image URLs. */
export function summarizePrintingIdentity(card: ScryfallCard): PrintingIdentity {
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
    // Folded at the boundary rather than echoed: the cache omits `en`, but raw
    // Scryfall JSON spells it out, and the projection's contract is one spelling
    // — absent means English.
    lang: card.lang === 'en' ? undefined : card.lang,
  }
}

/** {@link summarizePrintingIdentity} over a nullable card. */
export function summarizePrintingIdentityOrNull(
  card: ScryfallCard | null | undefined,
): PrintingIdentity | null {
  return card === null || card === undefined ? null : summarizePrintingIdentity(card)
}

/** Project a full Scryfall card to printing identity + prices, dropping image URLs etc. */
export function summarizePrinting(card: ScryfallCard): PrintingSummary {
  return { ...summarizePrintingIdentity(card), prices: card.prices }
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
 * how many printings the caller found — the projection never counts them itself
 * — and `printingsComplete` says whether that count can be trusted as the
 * card's total.
 */
export function detailCard(
  card: ScryfallCard,
  printingCount: number,
  printingsComplete: boolean,
): CardDetails {
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
    printingsComplete,
  }
}
