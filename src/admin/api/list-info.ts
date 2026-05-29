import path from 'node:path'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../../ritual-config'
import { resolveDeckFilePath } from '../../deck-file'
import { isPathWithinDir } from '../../path-validation'
import { loadAllLists } from '../../commands/move-helpers'
import type { ListType } from '../../list-type'

/**
 * Lightweight summary of a list (deck, collection, or wanted list) as the admin
 * API exposes it: a slug (the file basename, matching the load endpoints) plus a
 * display name. Shared by every endpoint that enumerates lists for the browser.
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

/**
 * Resolve a `type` + `slug` pair to a concrete list file path, or null when no
 * such file exists. Decks resolve through {@link resolveDeckFilePath} (matching
 * the deck load endpoint); collections and wanted lists map directly to
 * `<slug>.md` under their directory, guarded against path traversal.
 */
export async function resolveListFile(type: ListType, slug: string): Promise<string | null> {
  if (type === 'deck') {
    return resolveDeckFilePath(getDecksDir(), slug)
  }
  const dir = type === 'collection' ? getCollectionsDir() : getWantedDir()
  const filePath = path.join(dir, `${slug}.md`)
  if (!isPathWithinDir(filePath, dir)) return null
  if (!(await Bun.file(filePath).exists())) return null
  return filePath
}
