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
