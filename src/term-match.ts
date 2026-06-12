/**
 * Space-separated term matching shared by the CLI session filter and the site's
 * card filters: every whitespace-separated term of `query` must appear in `text`,
 * case-insensitively. An empty query matches everything.
 */
export function matchesAllTerms(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((term) => lower.includes(term))
}
