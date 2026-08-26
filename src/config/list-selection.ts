// Browser-safe home for public-site list selection: the `include*`/`exclude*`
// settings and the pure helpers that interpret them. Kept free of Node imports so
// both the CLI (via ritual-config) and the admin SPA can use it.

/**
 * Which lists are published when building the public site. Each category has two
 * lists:
 *
 * - `include*` — either the reserved wildcard `['*']` (the default — include
 *   every list in that category) or an explicit set of list display names to
 *   include; all others are filtered out. An empty array includes none.
 * - `exclude*` — display names to drop even when the include list selects them
 *   (exclusion always wins). Defaults to an empty array, and has no wildcard.
 */
export type SiteSelectionConfig = {
  includeDecks: string[]
  includeCollections: string[]
  includeWantedLists: string[]
  excludeDecks: string[]
  excludeCollections: string[]
  excludeWantedLists: string[]
}

/** The reserved wildcard list value that means "include everything in this category". */
export const INCLUDE_ALL = '*'

/**
 * The default selection: every include list set to the wildcard (publish all)
 * and every exclude list empty.
 */
export function defaultSiteSelection(): SiteSelectionConfig {
  return {
    includeDecks: [INCLUDE_ALL],
    includeCollections: [INCLUDE_ALL],
    includeWantedLists: [INCLUDE_ALL],
    excludeDecks: [],
    excludeCollections: [],
    excludeWantedLists: [],
  }
}

/**
 * Whether an `include*` selection list means "include everything". The reserved
 * wildcard is `'*'`; a list containing it (e.g. the default `['*']`) selects all.
 */
export function includesAllLists(include: string[]): boolean {
  return include.includes(INCLUDE_ALL)
}

/**
 * Filter discovered list entries by an include/exclude selection, matching each
 * entry on its display name. The `include` list selects the candidate set — a
 * wildcard selection (see {@link includesAllLists}) keeps every entry, otherwise
 * only entries whose display name exactly matches one of the listed names. The
 * `exclude` list then removes any matching names, even ones the include list
 * implied; exclusion always wins.
 */
export function filterBySelection<T>(
  entries: T[],
  include: string[],
  exclude: string[],
  displayNameOf: (entry: T) => string,
): T[] {
  // `null` wanted-set means the wildcard include selects everything; otherwise an
  // entry must appear in `wanted`. Either way an excluded name is always dropped.
  const wanted = includesAllLists(include) ? null : new Set(include)
  const excluded = new Set(exclude)
  return entries.filter((entry) => {
    const name = displayNameOf(entry)
    if (wanted && !wanted.has(name)) return false
    return !excluded.has(name)
  })
}
