import type { ScryfallCard } from '../types'
import { scryfallCardLanguage } from '../card-language'

export type CardNameFilter = {
  sets?: string[]
  excludeDigitalOnly?: boolean
}

export function isDigitalOnlySet(setCode: string): boolean {
  const lower = setCode.toLowerCase()
  return (lower.length === 4 && lower.startsWith('a')) || lower === 'om1'
}

/** Returns true if the card is a token. */
export function isToken(card: ScryfallCard): boolean {
  if (card.layout === 'token' || card.layout === 'double_faced_token') return true
  // Fallback for cached cards where layout was not preserved:
  // tokens always carry "Token" as a supertype in their type line.
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

/** Map a raw Scryfall JSON object to a normalized ScryfallCard. */
export function mapScryfallCard(item: ScryfallCard): ScryfallCard {
  return {
    // The printing's language. `en` is deliberately dropped rather than stored:
    // absent means `en` everywhere `lang` is read, and omitting it keeps an
    // en-mode (`default_cards`) cache byte-identical to what it was before
    // languages existed — no churn, no size cost.
    ...(item.lang !== undefined && item.lang !== 'en' ? { lang: item.lang } : {}),
    id: item.id,
    oracle_id: item.oracle_id,
    illustration_id: item.illustration_id,
    name: item.name,
    layout: item.layout,
    cmc: item.cmc || 0,
    edhrec_rank: item.edhrec_rank || 999999,
    mana_cost: item.mana_cost,
    type_line: item.type_line,
    oracle_text: item.oracle_text,
    image_uris: item.image_uris,
    card_faces: item.card_faces,
    prices: {
      usd: item.prices.usd ?? null,
      usd_foil: item.prices.usd_foil ?? null,
      usd_etched: item.prices.usd_etched ?? null,
      eur: item.prices.eur ?? null,
      eur_foil: item.prices.eur_foil ?? null,
      tix: item.prices.tix ?? null,
    },
    finishes: item.finishes,
    games: item.games ?? [],
    set: item.set.toLowerCase(),
    set_name: item.set_name,
    collector_number: item.collector_number,
    rarity: item.rarity,
    color_identity: item.color_identity || [],
    colors: item.colors,
    keywords: item.keywords,
    legalities: item.legalities,
    released_at: item.released_at,
    // Preserve any already-attached tags so the mapper round-trips enriched cards.
    oracleTags: item.oracleTags,
    artTags: item.artTags,
  }
}

/** Compare collector numbers naturally: numeric part first, then suffix */
function compareCollectorNumbers(a: string, b: string): number {
  const numA = parseInt(a, 10)
  const numB = parseInt(b, 10)
  if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB
  if (!isNaN(numA) && !isNaN(numB)) return a.localeCompare(b)
  return a.localeCompare(b, undefined, { numeric: true })
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
  if (dateA !== dateB) return dateB.localeCompare(dateA)
  const setCmp = a.set.localeCompare(b.set)
  if (setCmp !== 0) return setCmp
  const cnCmp = compareCollectorNumbers(a.collector_number, b.collector_number)
  if (cnCmp !== 0) return cnCmp
  const langA = scryfallCardLanguage(a)
  const langB = scryfallCardLanguage(b)
  if (langA === langB) return 0
  if (langA === 'en') return -1
  if (langB === 'en') return 1
  return langA.localeCompare(langB)
}
