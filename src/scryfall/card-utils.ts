import type { ScryfallCard } from './types'
import { compareData, compareDataNumeric } from '../i18n/collate'
import { scryfallCardLanguage } from '../card/card-language'

export type CardNameFilter = {
  sets?: string[]
  excludeDigitalOnly?: boolean
}

/**
 * A filter's set codes as a lowercase membership set, or null when the filter
 * names no sets and therefore selects all of them. One place applies the
 * lowercase-internally rule, rather than every consumer of {@link CardNameFilter}
 * spelling it out.
 */
export function normalizeSetFilter(filter?: CardNameFilter): ReadonlySet<string> | null {
  if (!filter?.sets || filter.sets.length === 0) return null
  return new Set(filter.sets.map((s) => s.toLowerCase()))
}

export function isDigitalOnlySet(setCode: string): boolean {
  const lower = setCode.toLowerCase()
  return (lower.length === 4 && lower.startsWith('a')) || lower === 'om1'
}

/** Returns true if the card is a token. */
export function isToken(card: ScryfallCard): boolean {
  if (card.layout === 'token' || card.layout === 'double_faced_token') return true
  // Fallback for cached cards where layout was not preserved:
  // tokens always carry "Token" as a supertype in their type line. A card that
  // does carry a layout has already answered — a reversible printing's lifted
  // type line (see `mapScryfallCard`) must not reclassify a printing the ingest
  // kept.
  if (card.layout !== undefined) return false
  return /\bToken\b/.test(card.type_line ?? '')
}

/**
 * Returns true if the card is an Art Series print — the oversized art-only
 * cards printed in set boosters. They share their name with the real card (or,
 * for double-faced cards, carry it twice as `Name // Name`), so leaving them in
 * the cache pollutes both name autocomplete and the printing pickers with
 * entries no list should ever reference.
 */
export function isArtSeries(card: ScryfallCard): boolean {
  return card.layout === 'art_series'
}

/** Returns true if the card is only available on Arena (no paper or MTGO). */
export function isArenaOnly(card: ScryfallCard): boolean {
  const games = card.games ?? []
  return games.length > 0 && !games.includes('paper') && !games.includes('mtgo')
}

/** Why a printing is kept out of the card cache. */
export type PrintingExclusion = 'arena-only' | 'token' | 'art-series'

/**
 * Classify a printing no list should ever reference, or `null` when it is a
 * real, paper-obtainable card. This is the single definition of what the cache
 * excludes — every ingest and search path filters through it, so a new
 * exclusion reaches all of them at once.
 */
export function classifyExcludedPrinting(card: ScryfallCard): PrintingExclusion | null {
  if (isArenaOnly(card)) return 'arena-only'
  if (isToken(card)) return 'token'
  if (isArtSeries(card)) return 'art-series'
  return null
}

/** Returns true when the printing is a real card a list may reference. */
export function isRealPrinting(card: ScryfallCard): boolean {
  return classifyExcludedPrinting(card) === null
}

/** Returns the union of all `games` arrays across printings. */
export function getCardGames(printings: ScryfallCard[]): string[] {
  const gamesSet = new Set<string>()
  for (const card of printings) {
    for (const game of card.games ?? []) {
      gamesSet.add(game)
    }
  }
  return Array.from(gamesSet)
}

/** Extract the front-face name from a double-faced card name like "Fire // Ice". */
export function getFrontFaceName(name: string): string {
  return name.includes(' // ') ? name.split(' // ')[0]!.trim() : name.trim()
}

/**
 * Fold a name that repeats a face onto the card it prints: `Forest // Forest`
 * → `Forest`, and a reversible Omen's `Bloomvine Regent // Claim Territory //
 * Bloomvine Regent` → `Bloomvine Regent // Claim Territory`. Every other name,
 * split cards (`Fire // Ice`) included, comes back unchanged.
 *
 * Scryfall names a reversible printing — the same card on both sides, each with
 * its own art — by joining its faces, so without this every such printing sits
 * under a name of its own beside the card's other printings. This is the one
 * rule the card data folds them by: the ingest names printings by it, and the
 * card cache folds its lookup keys by it, so a list line written with the
 * repeated spelling still reaches the card. List files are not rewritten, and
 * name-keyed list data (categories) keeps the spelling a line carries. Exact
 * and case-preserving, which makes it safe on an already-lowercased key.
 */
export function foldRepeatedFaceNames(name: string): string {
  if (!name.includes(' // ')) return name
  const parts = name.split(' // ')
  const distinct = [...new Set(parts)]
  return distinct.length === parts.length ? name : distinct.join(' // ')
}

/** One face of a multi-faced card. */
export type CardFace = NonNullable<ScryfallCard['card_faces']>[number]

/**
 * A card's faces with repeated faces dropped, by name: a reversible printing's
 * two `Forest` faces are one face of text, though each keeps its own image.
 * What text renderers iterate, so the same oracle text never shows twice.
 */
export function distinctCardFaces(faces: readonly CardFace[]): CardFace[] {
  const seen = new Set<string>()
  return faces.filter((face) => {
    if (seen.has(face.name)) return false
    seen.add(face.name)
    return true
  })
}

/** The gameplay fields a reversible printing carries only on its faces. */
type LiftedFaceFields = Pick<
  ScryfallCard,
  'oracle_id' | 'type_line' | 'mana_cost' | 'oracle_text' | 'cmc' | 'colors'
>

/**
 * The card-level fields of a printing that has the same card on every face, or
 * `null` for any other card.
 *
 * Scryfall leaves a `reversible_card` printing's top level bare — no
 * `oracle_id`, `type_line`, `mana_cost`, or `cmc` — because each side is a full
 * card face of its own. Every face sharing one `oracle_id` is what says those
 * sides are one card, and it is what lets the printing join that card's other
 * printings under one name without reading as a typeless, zero-cost card there.
 * The multi-part fields join the distinct faces the way Scryfall spells them on
 * the card's ordinary printings (`{3}{G}{G} // {2}{G}` for an Omen); oracle
 * text stays on the faces when there is more than one.
 */
function sameCardFaceFields(item: ScryfallCard): LiftedFaceFields | null {
  const faces = item.card_faces
  const front = faces?.[0]
  if (item.oracle_id !== undefined || !faces || !front?.oracle_id) return null
  if (faces.some((face) => face.oracle_id !== front.oracle_id)) return null
  const distinct = distinctCardFaces(faces)
  return {
    oracle_id: front.oracle_id,
    type_line: distinct.map((face) => face.type_line).join(' // '),
    mana_cost: distinct.map((face) => face.mana_cost).join(' // '),
    oracle_text: distinct.length === 1 ? front.oracle_text : undefined,
    cmc: front.cmc ?? 0,
    colors: front.colors,
  }
}

/**
 * Map a raw Scryfall JSON object to a normalized ScryfallCard.
 *
 * A reversible printing is named for the card it prints
 * ({@link foldRepeatedFaceNames}) and given that card's top-level fields, while
 * keeping its `layout` and both `card_faces` — so it groups with the card's
 * other printings and still shows, and flips to, its second side.
 */
export function mapScryfallCard(item: ScryfallCard): ScryfallCard {
  const sameCard = sameCardFaceFields(item)
  return {
    // The printing's language. `en` is deliberately dropped rather than stored:
    // absent means `en` everywhere `lang` is read, and omitting it keeps an
    // en-mode (`default_cards`) cache byte-identical to what it was before
    // languages existed — no churn, no size cost.
    ...(item.lang !== undefined && item.lang !== 'en' ? { lang: item.lang } : {}),
    id: item.id,
    oracle_id: item.oracle_id ?? sameCard?.oracle_id,
    illustration_id: item.illustration_id,
    name: foldRepeatedFaceNames(item.name),
    layout: item.layout,
    cmc: item.cmc || sameCard?.cmc || 0,
    edhrec_rank: item.edhrec_rank || 999999,
    mana_cost: item.mana_cost ?? sameCard?.mana_cost,
    type_line: item.type_line ?? sameCard?.type_line,
    oracle_text: item.oracle_text ?? sameCard?.oracle_text,
    image_uris: item.image_uris,
    card_faces: item.card_faces,
    prices: {
      usd: item.prices.usd ?? null,
      usd_foil: item.prices.usd_foil ?? null,
      usd_etched: item.prices.usd_etched ?? null,
      eur: item.prices.eur ?? null,
      eur_foil: item.prices.eur_foil ?? null,
      // Dropped when absent rather than stored as null, like `lang` above:
      // Scryfall publishes it only for the few etched printings Cardmarket
      // quotes, and omitting it keeps the other ~100k cached rows byte-
      // identical to what they were before the field existed.
      ...(item.prices.eur_etched != null ? { eur_etched: item.prices.eur_etched } : {}),
      tix: item.prices.tix ?? null,
    },
    finishes: item.finishes,
    games: item.games ?? [],
    set: item.set.toLowerCase(),
    set_name: item.set_name,
    collector_number: item.collector_number,
    rarity: item.rarity,
    color_identity: item.color_identity || [],
    colors: item.colors ?? sameCard?.colors,
    keywords: item.keywords,
    legalities: item.legalities,
    released_at: item.released_at,
    // Preserve any already-attached tags so the mapper round-trips enriched cards.
    oracleTags: item.oracleTags,
    artTags: item.artTags,
  }
}

/**
 * Compare collector numbers naturally: numeric part first, then suffix. The one
 * ordering rule for collector numbers — {@link comparePrintings} sorts every
 * printing picker by it, and the session editor's collector-mode rows share it,
 * so the two never disagree about where `2a` or `A-12` belongs.
 */
export function compareCollectorNumbers(a: string, b: string): number {
  const numA = parseInt(a, 10)
  const numB = parseInt(b, 10)
  if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB
  if (!isNaN(numA) && !isNaN(numB)) return compareData(a, b)
  return compareDataNumeric(a, b)
}

/**
 * Sort printings by release date (newest first), then set code and collector
 * number, and finally by language — the default-language object (`en`, which an
 * absent `lang` also means) sorts before other languages, so pickers rendering
 * an `all_cards`-backed cache list each printing's default object first.
 */
export function comparePrintings(a: ScryfallCard, b: ScryfallCard): number {
  const dateA = a.released_at ?? ''
  const dateB = b.released_at ?? ''
  if (dateA !== dateB) return compareData(dateB, dateA)
  const setCmp = compareData(a.set, b.set)
  if (setCmp !== 0) return setCmp
  const cnCmp = compareCollectorNumbers(a.collector_number, b.collector_number)
  if (cnCmp !== 0) return cnCmp
  const langA = scryfallCardLanguage(a)
  const langB = scryfallCardLanguage(b)
  if (langA === langB) return 0
  if (langA === 'en') return -1
  if (langB === 'en') return 1
  return compareData(langA, langB)
}
