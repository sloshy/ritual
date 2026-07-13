import { getFrontFaceName } from './scryfall/card-utils'

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
 * without the apostrophe. Card searches use this so that a name typed without its
 * punctuation still reaches {@link promoteFullNameMatches} rather than being
 * filtered out before it can be promoted.
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
