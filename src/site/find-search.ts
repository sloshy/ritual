/**
 * Card-name matching for the public-site "Find" page.
 *
 * The user pastes a list of card names; each line is matched by *front-face name*
 * against the cards present in every list. Double-faced names (`Front // Back`)
 * are matched on their front face only — anything from the first `//` on is
 * discarded — so a search for `Bruce Banner` matches `Bruce Banner // The
 * Incredible Hulk` but `The Incredible Hulk` does not. Because both the query
 * and the card name are reduced to their front face, a search for `Steam Vents`
 * also matches double-art printings named `Steam Vents // Steam Vents`.
 */

import { normalizeForSearch } from '../term-match'

/** The front face of a possibly double-faced name: text before the first `//`, trimmed. */
export function frontFaceName(name: string): string {
  const idx = name.indexOf('//')
  return (idx >= 0 ? name.slice(0, idx) : name).trim()
}

/**
 * Normalized match key for a card name: front face only, diacritic- and
 * case-folded. Two names share a key iff they refer to the same front face.
 */
export function findMatchKey(name: string): string {
  return normalizeForSearch(frontFaceName(name))
}

/** Split textarea input into trimmed, non-empty query lines, preserving order. */
export function parseSearchLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export interface SearchPartition {
  /** Match keys that matched at least one present card. */
  found: Set<string>
  /** Query lines whose match key matched nothing, in first-seen order, de-duplicated by key. */
  notFound: string[]
}

/**
 * Partition query lines into found / not-found against the set of match keys
 * present across the searched lists. Not-found lines keep their original text
 * (so they can be left in the textarea) and are de-duplicated by match key.
 */
export function partitionSearch(lines: string[], presentKeys: Set<string>): SearchPartition {
  const found = new Set<string>()
  const notFound: string[] = []
  const seenNotFound = new Set<string>()
  for (const line of lines) {
    const key = findMatchKey(line)
    if (!key) continue
    if (presentKeys.has(key)) {
      found.add(key)
    } else if (!seenNotFound.has(key)) {
      seenNotFound.add(key)
      notFound.push(line)
    }
  }
  return { found, notFound }
}
