import { getFrontFaceName } from '../scryfall/card-utils'

/**
 * Canonical normalization for all card- and list-name searching across the
 * project (CLI, public site, admin site, and the admin API). The name and the
 * query are reduced to the same form so that searches are both case- and
 * diacritic-insensitive: NFD-decompose so accents become combining marks, strip
 * those marks, then lowercase. This lets `Jotun` match `Jötun`, `Seance` match
 * `Séance`, and so on.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Space-separated term matching shared by the CLI session filter and the site's
 * card filters: every whitespace-separated term of `query` must appear in `text`,
 * case- and diacritic-insensitively (see {@link normalizeForSearch}). An empty
 * query matches everything.
 */
export function matchesAllTerms(text: string, query: string): boolean {
  const normalized = normalizeForSearch(text)
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean)
  return terms.every((term) => normalized.includes(term))
}

/**
 * {@link matchesAllTerms} for card names specifically: also punctuation-insensitive
 * (see {@link normalizeCardName}), so `jaces archivist` matches `Jace's Archivist`
 * without the apostrophe. Card searches filter with this and then order what
 * survives with {@link rankNameMatches}, so a name typed without its punctuation
 * still reaches the ranking rather than being dropped before it can be promoted.
 */
export function matchesAllNameTerms(text: string, query: string): boolean {
  return matchesNameTerms(normalizeCardName(text), splitNameTerms(query))
}

/**
 * The two halves of {@link matchesAllNameTerms}, for searches hot enough to
 * normalize each side only once: the trade page keeps a normalized key per card
 * entry and re-matches every entry on each keystroke, so it splits the query into
 * terms once and matches them against keys it never has to re-normalize.
 */
export function splitNameTerms(query: string): string[] {
  return normalizeCardName(query).split(' ').filter(Boolean)
}

/** Whether an already-{@link normalizeCardName}d name contains every one of `terms`. */
export function matchesNameTerms(normalizedName: string, terms: string[]): boolean {
  return terms.every((term) => normalizedName.includes(term))
}

/**
 * Whether every one of `terms` begins a *word* of an already-{@link normalizeCardName}d
 * name. Stricter than {@link matchesNameTerms}, which is satisfied by a term landing
 * mid-word: `in tre` matches "Kin-Tree Warden" by substring but not by word prefix.
 *
 * This is what makes a query like `in tre` usable — typing the start of each word is
 * how people search, so those names are the ones {@link rankNameMatches} floats to the
 * top when the local card cache is searched (the CLI prompts and the admin API's
 * autocomplete).
 */
export function matchesNameWordPrefixes(normalizedName: string, terms: string[]): boolean {
  const words = normalizedName.split(' ')
  return terms.every((term) => words.some((word) => word.startsWith(term)))
}

/** {@link matchesNameWordPrefixes}, with the words additionally matched left to right. */
function matchesNameWordPrefixesInOrder(normalizedName: string, terms: string[]): boolean {
  const words = normalizedName.split(' ')
  let from = 0
  for (const term of terms) {
    const index = words.findIndex((word, i) => i >= from && word.startsWith(term))
    if (index === -1) return false
    from = index + 1
  }
  return true
}

/**
 * Normalize a card name for whole-name matching: fold case and diacritics (so
 * `Téferi` matches `teferi`), then strip punctuation and collapse whitespace, so
 * `jaces archivist` matches `Jace's Archivist`. Diacritics are folded to their
 * base letters *before* punctuation removal so accented letters survive as their
 * plain forms rather than being dropped entirely.
 */
export function normalizeCardName(name: string): string {
  return normalizeForSearch(name)
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Two-tier name matching shared by the one-shot card commands and scripted
 * moves: items whose {@link normalizeCardName}d name equals the normalized
 * query win outright; only when none do does the match widen to items whose
 * name contains the query as a substring. An empty (or punctuation-only) query
 * matches nothing. Exactness beating containment is what lets a card literally
 * named `Bolt` be selected even though `Bolt` is a substring of every
 * `Lightning Bolt` in the same list.
 */
export function matchByNormalizedName<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  const normalized = normalizeCardName(query)
  if (!normalized) return []
  const exact = items.filter((item) => normalizeCardName(nameOf(item)) === normalized)
  if (exact.length > 0) return exact
  return items.filter((item) => normalizeCardName(nameOf(item)).includes(normalized))
}

/**
 * Reorder search results so that cards whose *whole* name the query spells out
 * come first, without otherwise disturbing the incoming order (which is EDHRec
 * popularity nearly everywhere card search happens).
 *
 * Popularity ranking alone buries an unpopular card even once you've typed its
 * name in full: searching `The End` leaves the card named "The End" far below
 * every popular card that merely contains those letters. A query that spells out
 * a name completely is a strong signal that it is the card you meant, so those
 * matches are promoted above the merely-partial ones. Comparison uses
 * {@link normalizeCardName}, so case, accents, and punctuation don't have to be
 * typed exactly.
 *
 * Two tiers are promoted, in order: names matched in full, then double-faced
 * cards whose front face is matched in full (typing `Delver of Secrets` should
 * find "Delver of Secrets // Insectile Aberration"). Ties inside a tier keep
 * their incoming order, so popularity still breaks them.
 */
export function promoteFullNameMatches<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string,
): T[] {
  const normalizedQuery = normalizeCardName(query)
  if (!normalizedQuery) return items

  const fullMatches: T[] = []
  const frontFaceMatches: T[] = []
  const rest: T[] = []

  for (const item of items) {
    const name = nameOf(item)
    if (normalizeCardName(name) === normalizedQuery) {
      fullMatches.push(item)
      continue
    }
    const frontFace = getFrontFaceName(name)
    if (frontFace !== name && normalizeCardName(frontFace) === normalizedQuery) {
      frontFaceMatches.push(item)
      continue
    }
    rest.push(item)
  }

  if (fullMatches.length === 0 && frontFaceMatches.length === 0) return items
  return [...fullMatches, ...frontFaceMatches, ...rest]
}

/** A card-name search result decorated with its {@link nameMatchRank}, for sorting. */
type RankedNameMatch<T> = { item: T; rank: NameMatchRankValue }

/**
 * How well a name answers a term query, lowest (best) first. The tiers rank the
 * ways a name can satisfy {@link matchesNameTerms}, from "you typed the name" down
 * to "the letters happen to be in there somewhere".
 */
const NameMatchRank = {
  /** The query spells out the whole name. */
  FullName: 0,
  /** The query spells out the front face of a double-faced name. */
  FrontFace: 1,
  /** The name begins with the query, contiguously (`sol ri` → "Sol Ring"). */
  Prefix: 2,
  /** Every term begins a word, left to right (`in tre` → "In the Trenches"). */
  WordPrefixesInOrder: 3,
  /** Every term begins a word, in any order (`tre in` → "In the Trenches"). */
  WordPrefixes: 4,
  /** Every term appears somewhere, possibly mid-word (`in tre` → "Kin-Tree Warden"). */
  Substring: 5,
} as const

type NameMatchRankValue = (typeof NameMatchRank)[keyof typeof NameMatchRank]

function nameMatchRank(name: string, normalizedQuery: string, terms: string[]): NameMatchRankValue {
  const normalized = normalizeCardName(name)
  if (normalized === normalizedQuery) return NameMatchRank.FullName
  const frontFace = getFrontFaceName(name)
  if (frontFace !== name && normalizeCardName(frontFace) === normalizedQuery) {
    return NameMatchRank.FrontFace
  }
  if (normalized.startsWith(normalizedQuery)) return NameMatchRank.Prefix
  if (matchesNameWordPrefixesInOrder(normalized, terms)) return NameMatchRank.WordPrefixesInOrder
  if (matchesNameWordPrefixes(normalized, terms)) return NameMatchRank.WordPrefixes
  return NameMatchRank.Substring
}

/**
 * Order card-name search results by how directly they answer the query — the
 * ranking shared by every surface that searches names by term (the CLI's add and
 * session prompts, the admin autocomplete API, and the public site's Scryfall
 * search), so the same typing produces the same top results everywhere.
 *
 * Term matching alone ({@link matchesAllNameTerms}) is deliberately loose: `in tre`
 * matches 80 real cards, most of them because "in" and "tre" landed mid-word
 * ("Arctic Treeline", "Anafenza, Kin-Tree Spirit"). Popularity order then buries
 * the card actually being typed — "In the Trenches" sits 20th, past the end of a
 * suggestion list. Ranking by *how* each name matched floats the handful whose
 * words the terms begin, which is how the query was meant to be read.
 *
 * Ties keep their incoming order, so whatever the caller sorted by (EDHRec
 * popularity for cached and Scryfall results, alphabetical for the admin API)
 * still breaks them. Supersedes {@link promoteFullNameMatches} — its two tiers
 * lead this ranking — for callers whose query is card-name terms rather than
 * Scryfall search syntax.
 */
export function rankNameMatches<T>(items: T[], query: string, nameOf: (item: T) => string): T[] {
  const normalizedQuery = normalizeCardName(query)
  if (!normalizedQuery) return items
  const terms = splitNameTerms(query)

  const ranked: RankedNameMatch<T>[] = items.map((item) => ({
    item,
    rank: nameMatchRank(nameOf(item), normalizedQuery, terms),
  }))
  // Array.prototype.sort is stable, so equal ranks keep the incoming order.
  ranked.sort((a, b) => a.rank - b.rank)
  return ranked.map((entry) => entry.item)
}
