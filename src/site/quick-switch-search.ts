/**
 * Strict substring search for the Quick Switch dialog.
 *
 * The query is split on whitespace into terms; every term must appear as a
 * substring of the candidate name (case- and diacritic-insensitive). A name
 * matching all terms gets a positive score; non-matches return -1.
 */

import { normalizeForSearch } from '../term-match'

export function scoreMatch(name: string, query: string): number {
  const trimmed = query.trim()
  if (!trimmed) return 0
  const normalizedName = normalizeForSearch(name)
  const terms = trimmed
    .split(/\s+/)
    .map(normalizeForSearch)
    .filter((t) => t.length > 0)
  if (terms.length === 0) return 0

  let total = 0
  for (const term of terms) {
    const idx = normalizedName.indexOf(term)
    if (idx < 0) return -1
    if (normalizedName === term) total += 1000
    else if (idx === 0) total += 500 - normalizedName.length
    else total += 250 - idx
  }
  return total
}
