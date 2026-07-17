import path from 'node:path'
import { getCollectionsDir, getDecksDir, getWantedDir } from '../../ritual-config'
import { resolveDeckFilePath } from '../../deck-file'
import { isPathWithinDir } from '../../path-validation'
import type { ListType } from '../../list-type'

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
