import path from 'node:path'
import { loadAllLists } from '../commands/move-helpers'
import type { ListType } from './list-type'

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

/** The file basename (without extension) used as a list's slug, matching the load endpoints. */
export function listSlug(filePath: string): string {
  return path.basename(filePath).replace(/\.(md|txt)$/i, '')
}

/** Enumerate every list across all three types as slug-keyed {@link ListInfo} summaries. */
export async function loadListInfos(): Promise<ListInfo[]> {
  const lists = await loadAllLists()
  return lists.map((l) => ({ type: l.ref.type, slug: listSlug(l.filePath), name: l.ref.name }))
}
