import type { ListRef } from '../changes/change-event'
import { listSlug } from './list-file-name'
import { listLocations } from './resolve-list'
import { listDisplayName } from './list-lifecycle'
import type { ListIdentity, ListInfo } from './list-identity'
import type { ListLocation } from './resolve-list'
import { nestSync, syncMessage, type SyncMessage } from '../sync/message'
import type { MessageKey } from '../i18n/messages/en'
import type { ParamsOf } from '../i18n/t'

/** A list on disk: its type + display name, and where the file lives. */
export type ListEntry = {
  ref: ListRef
  filePath: string
}

/** A located list's identity: its type and its file's basename. */
export function listIdentityOf(location: Pick<ListLocation, 'type' | 'filePath'>): ListIdentity {
  return { listType: location.type, slug: listSlug(location.filePath) }
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

/**
 * A {@link ListWarning}: `cause` nested under `key`, beside the list's identity.
 * `list.name` is the name the sentence calls the list by.
 */
export function listWarning(key: ListWarningKey, list: ListInfo, cause: SyncMessage): ListWarning {
  return {
    ...syncMessage(key, { list: list.name, cause: nestSync(cause) }),
    list: { listType: list.listType, slug: list.slug },
  }
}

/**
 * A located list's display name (a deck's front-matter `name`, a flat list's
 * `# Title`), falling back to its file basename when the file is unreadable or
 * names nothing — so a list is always named, never hidden.
 */
async function displayNameOf(location: Pick<ListLocation, 'type' | 'filePath'>): Promise<string> {
  const fallback = listSlug(location.filePath)
  try {
    const name = await listDisplayName(location.type, location.filePath)
    return name.length > 0 ? name : fallback
  } catch {
    return fallback
  }
}

/** A located list as a {@link ListInfo}, its display name read from the file. */
export async function loadListInfo(
  location: Pick<ListLocation, 'type' | 'filePath'>,
): Promise<ListInfo> {
  return { ...listIdentityOf(location), name: await displayNameOf(location) }
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
      ref: { type: location.type, name: await displayNameOf(location) },
      filePath: location.filePath,
    })),
  )
}

/** A list on disk as a {@link ListInfo}: its type, its file's slug, its display name. */
export function listInfoOf(entry: ListEntry): ListInfo {
  return { listType: entry.ref.type, slug: listSlug(entry.filePath), name: entry.ref.name }
}

/** Enumerate every list across all three types as slug-keyed {@link ListInfo} summaries. */
export async function loadListInfos(): Promise<ListInfo[]> {
  return (await loadAllLists()).map(listInfoOf)
}
