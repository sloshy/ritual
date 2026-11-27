import type { ListRef } from '../changes/change-event'
import { listSlug } from './list-file-name'
import { listLocations } from './resolve-list'
import { listDisplayName } from './list-lifecycle'
import type { ListType } from './list-type'
import type { ListLocation } from './resolve-list'
import { nestSync, syncMessage, type SyncMessage } from '../sync/message'
import type { MessageKey } from '../i18n/messages/en'
import type { ParamsOf } from '../i18n/t'

/** A list on disk: its type + display name, and where the file lives. */
export type ListEntry = {
  ref: ListRef
  filePath: string
}

/**
 * Lightweight summary of a list (deck, collection, or wanted list): a slug (the
 * file basename, matching the admin load endpoints) plus a display name. Shared
 * by every surface that enumerates lists — the `lists` CLI command, the admin
 * API, and the admin site.
 */
export type ListInfo = ListSlugRef & {
  name: string
}

/**
 * A list's identity: its type and slug (the file basename). Two lists of
 * different types may share a slug, and two lists may share a display name,
 * so this pair — never a name — is what finds a list.
 */
export type ListSlugRef = {
  type: ListType
  slug: string
}

/**
 * {@link ListSlugRef} in the vocabulary of the API, the MCP tools and new JSON
 * payloads, which spell the type `listType`: the identity a cross-list result
 * (a summary row, a price warning, a list reference in a query) names a list by.
 */
export interface ListIdentity {
  listType: ListType
  slug: string
}

/** A located list's identity: its type and its file's basename. */
export function listIdentityOf(location: Pick<ListLocation, 'type' | 'filePath'>): ListIdentity {
  return { listType: location.type, slug: listSlug(location.filePath) }
}

/** A list identity as one string (`type:slug`), for sets and maps keyed by list. */
export function listIdentityKey({ listType, slug }: ListIdentity): string {
  return `${listType}:${slug}`
}

/**
 * `refs` with every repeat of a list dropped, first mention kept — the rule a
 * selection by explicit lists follows, so naming a list twice never counts it
 * twice.
 */
export function uniqueListIdentities<T extends ListIdentity>(refs: readonly T[]): T[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = listIdentityKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * A warning about one list, naming it by identity beside the message, so a
 * client can tell which list (and so which row or total) to distrust.
 */
export type ListWarning = SyncMessage & { list: ListIdentity }

/** The param names a list warning's message interpolates. */
type ListWarningParam = 'list' | 'cause'

/**
 * The keys a list warning can be worded with: every catalog key whose params
 * are exactly `{list}` (the list's name) and `{cause}` (what went wrong) —
 * read off the catalog, so a new such key needs no edit here.
 */
export type ListWarningKey = {
  [K in MessageKey]: [ParamsOf<K>] extends [ListWarningParam]
    ? [ListWarningParam] extends [ParamsOf<K>]
      ? K
      : never
    : never
}[MessageKey]

/** The list a warning is about: its identity and the name its sentence calls it by. */
export type NamedListIdentity = ListIdentity & { name: string }

/** A {@link ListWarning}: `cause` nested under `key`, beside the list's identity. */
export function listWarning(
  key: ListWarningKey,
  list: NamedListIdentity,
  cause: SyncMessage,
): ListWarning {
  return {
    ...syncMessage(key, { list: list.name, cause: nestSync(cause) }),
    list: { listType: list.listType, slug: list.slug },
  }
}

/**
 * Enumerate every list file across all three types, paired with its display
 * name. One walk ({@link listLocations}) so the directory rules live in one
 * place; per-file tolerance so an unreadable list still appears, named by its
 * slug, rather than hiding every list after it.
 */
export async function loadAllLists(): Promise<ListEntry[]> {
  const locations = await listLocations()
  return Promise.all(
    locations.map(async (location): Promise<ListEntry> => ({
      ref: {
        type: location.type,
        name: await listDisplayName(location.type, location.filePath).catch(() => location.name),
      },
      filePath: location.filePath,
    })),
  )
}

/** Enumerate every list across all three types as slug-keyed {@link ListInfo} summaries. */
export async function loadListInfos(): Promise<ListInfo[]> {
  const lists = await loadAllLists()
  return lists.map((l) => ({ type: l.ref.type, slug: listSlug(l.filePath), name: l.ref.name }))
}
