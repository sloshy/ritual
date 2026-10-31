/**
 * "Did you mean …?" for a list name that matched nothing: the existing names a
 * typo most plausibly meant. Pure, so the resolver's not-found error can carry
 * the suggestions and every surface that reports one words them the same way.
 */
import { normalizeListName } from './list-file-name'

/** The most names a not-found error suggests. */
export const MAX_LIST_NAME_SUGGESTIONS = 3

/**
 * Optimal-string-alignment edit distance: insertions, deletions, substitutions
 * and swaps of two adjacent characters each cost one, so `Bindr`, `Bindre` and
 * `Bidner` are all one edit from `Binder`. Counted in code points.
 */
export function editDistance(left: string, right: string): number {
  // Code points, not UTF-16 units: an emoji in a list name is one character.
  const a = Array.from(left)
  const b = Array.from(right)
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1)
      }
      d[i]![j] = best
    }
  }
  return d[a.length]![b.length]!
}

/**
 * How many edits a name may be from the query and still be suggested: about
 * one per four characters of the longer name, and at least one, so a short
 * name only matches a near-identical one.
 */
function editBudget(a: string, b: string): number {
  return Math.max(1, Math.floor(Math.max(Array.from(a).length, Array.from(b).length) / 4))
}

/** A candidate name and its distance from the query. */
type ScoredName = { name: string; distance: number }

/**
 * The names (as written) within {@link editBudget} edits of `query`, both
 * folded the way the resolver folds them ({@link normalizeListName}): closest
 * first, ties in the order `names` lists them, at most {@link MAX_LIST_NAME_SUGGESTIONS}. Empty
 * when nothing is close, or when the query folds to nothing.
 */
export function suggestListNames(names: readonly string[], query: string): string[] {
  const folded = normalizeListName(query)
  if (folded === '') return []
  const scored: ScoredName[] = []
  for (const name of new Set(names)) {
    const candidate = normalizeListName(name)
    if (candidate === '') continue
    const distance = editDistance(folded, candidate)
    if (distance <= editBudget(folded, candidate)) scored.push({ name, distance })
  }
  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_LIST_NAME_SUGGESTIONS)
    .map((entry) => entry.name)
}
