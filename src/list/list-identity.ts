/**
 * The one list-reference vocabulary every surface speaks — the CLI's JSON, the
 * admin API, the MCP tools and both SPAs: a list is `{ listType, slug }`, named
 * `{ listType, slug, name }`, and an entry names its list `{ listType, listSlug,
 * listName }`. A browser-safe leaf: type-only imports, so either SPA may import
 * it without pulling in a Node module or the message catalog.
 */
import type { ListType } from './list-type'

/**
 * A list's identity: its type and slug (the file basename). Two lists of
 * different types may share a slug, and two lists may share a display name,
 * so this pair — never a name — is what finds a list.
 */
export interface ListIdentity {
  listType: ListType
  slug: string
}

/**
 * A list's identity plus its display name (its `# Title`, else its slug). Shared
 * by every surface that enumerates or reports lists, and by anything that names
 * a list in a sentence.
 */
export interface ListInfo extends ListIdentity {
  name: string
}

/** A report entry naming the list it came from by identity: its type and slug. */
export interface ListEntryOrigin {
  listType: ListType
  listSlug: string
}

/** A report entry's list: its identity plus its display name, for showing. */
export interface ListEntryLabel extends ListEntryOrigin {
  listName: string
}

/** A list identity as one string: `type:slug`. */
export type ListIdentityKey = `${ListType}:${string}`

/**
 * A list identity as one string (`type:slug`), for sets and maps keyed by list.
 * The same spelling as a `list=type:slug` query parameter. A slug holding a `:`
 * still keys uniquely: the type half never holds one, so the first `:` splits.
 */
export function listIdentityKey({ listType, slug }: ListIdentity): ListIdentityKey {
  return `${listType}:${slug}`
}

/**
 * Whether `value` is spelled as a {@link ListIdentityKey}: a list type, a `:`,
 * and a non-empty slug — for a key read back from storage or a form control.
 */
export function isListIdentityKey(value: string): value is ListIdentityKey {
  const colon = value.indexOf(':')
  if (colon < 0 || colon === value.length - 1) return false
  return Object.hasOwn(KEY_LIST_TYPES, value.slice(0, colon))
}

/**
 * The list types a key may start with — a record over {@link ListType}, so a
 * new list type is a compile error here until it is added. Kept local rather
 * than read from `list-type.ts`, whose runtime imports this leaf must not pull in.
 */
const KEY_LIST_TYPES = { deck: true, collection: true, wanted: true } as const satisfies Record<
  ListType,
  true
>

/** The key of the list an entry came from: {@link listIdentityKey} of its origin. */
export function entryListKey({ listType, listSlug }: ListEntryOrigin): ListIdentityKey {
  return `${listType}:${listSlug}`
}

/** The list label an entry of `list` carries. */
export function entryLabelOf({ listType, slug, name }: ListInfo): ListEntryLabel {
  return { listType, listSlug: slug, listName: name }
}

/** The list an entry's label names. */
export function listInfoOfEntry({ listType, listSlug, listName }: ListEntryLabel): ListInfo {
  return { listType, slug: listSlug, name: listName }
}

/**
 * The row in `rows` naming the list `identity` finds — never by position or
 * display name (a deck and a collection may share both a name and a slug).
 */
export function findByListIdentity<T extends ListIdentity>(
  rows: readonly T[],
  { listType, slug }: ListIdentity,
): T | undefined {
  return rows.find((row) => row.listType === listType && row.slug === slug)
}

/** The entries in `entries` that came from the list `identity` finds, in order. */
export function entriesOfList<T extends ListEntryOrigin>(
  entries: readonly T[],
  { listType, slug }: ListIdentity,
): T[] {
  return entries.filter((entry) => entry.listType === listType && entry.listSlug === slug)
}

/**
 * `refs` with every repeat of a list dropped, first mention kept — the rule a
 * selection by explicit lists follows, so naming a list twice never counts it
 * twice.
 */
export function uniqueListIdentities<T extends ListIdentity>(refs: readonly T[]): T[] {
  const seen = new Set<ListIdentityKey>()
  return refs.filter((ref) => {
    const key = listIdentityKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
