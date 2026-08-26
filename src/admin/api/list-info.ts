import path from 'node:path'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../../config/ritual-config'
import { resolveDeckFilePath } from '../../list/deck-file'
import { isPathWithinDir } from '../../util/path-validation'
import { listSlug } from '../../list/list-file-name'
import type { ListType } from '../../list/list-type'
import type { ListLocation } from '../../list/resolve-list'

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

/**
 * {@link resolveListFile} lifted to a {@link ListLocation}. `name` is
 * re-derived from the resolved path rather than echoing the slug parameter, so
 * report output carries the list's canonical name.
 */
export async function listLocationForSlug(
  type: ListType,
  slug: string,
): Promise<ListLocation | null> {
  const filePath = await resolveListFile(type, slug)
  if (!filePath) return null
  return { type, name: listSlug(filePath), filePath }
}
