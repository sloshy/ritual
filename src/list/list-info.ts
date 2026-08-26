import type { ListRef } from '../changes/change-event'
import { listSlug } from './list-file-name'
import { listLocations } from './resolve-list'
import { listDisplayName } from './list-lifecycle'
import type { ListType } from './list-type'

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
export type ListInfo = {
  type: ListType
  slug: string
  name: string
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
    locations.map(
      async (location): Promise<ListEntry> => ({
        ref: {
          type: location.type,
          name: await listDisplayName(location.type, location.filePath).catch(() => location.name),
        },
        filePath: location.filePath,
      }),
    ),
  )
}

/** Enumerate every list across all three types as slug-keyed {@link ListInfo} summaries. */
export async function loadListInfos(): Promise<ListInfo[]> {
  const lists = await loadAllLists()
  return lists.map((l) => ({ type: l.ref.type, slug: listSlug(l.filePath), name: l.ref.name }))
}
