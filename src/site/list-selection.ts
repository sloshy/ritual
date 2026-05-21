// Browser-safe home for public-site list selection: the `include*` settings and
// the pure helpers that interpret them. Kept free of Node imports so both the
// CLI (via ritual-config) and the admin SPA can use it.

/**
 * Which lists are published when building the public site. Each list is either
 * the reserved wildcard `['*']` (the default — include every list in that
 * category) or an explicit set of list display names to include; all others are
 * filtered out. An empty array includes none.
 */
export type SiteSelectionConfig = {
  includeDecks: string[]
  includeCollections: string[]
  includeWantedLists: string[]
}

/** The reserved wildcard list value that means "include everything in this category". */
export const INCLUDE_ALL = '*'

/** The default selection: every category set to the wildcard (publish all). */
export function defaultSiteSelection(): SiteSelectionConfig {
  return {
    includeDecks: [INCLUDE_ALL],
    includeCollections: [INCLUDE_ALL],
    includeWantedLists: [INCLUDE_ALL],
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
 * Filter discovered list entries down to those whose display name appears in the
 * `include` selection. A wildcard selection (see {@link includesAllLists})
 * returns every entry unchanged; otherwise only entries whose display name
 * exactly matches one of the listed names are kept.
 */
export function filterByIncludeList<T>(
  entries: T[],
  include: string[],
  displayNameOf: (entry: T) => string,
): T[] {
  if (includesAllLists(include)) {
    return entries
  }
  const wanted = new Set(include)
  return entries.filter((entry) => wanted.has(displayNameOf(entry)))
}
