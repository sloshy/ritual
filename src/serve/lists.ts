import { getSiteSelectionConfig, type RitualConfig } from '../config/ritual-config'
import { dirForType } from '../list/resolve-list'
import { resolveDeckSources, resolveListSources } from '../site/list-sources'
import { getErrorMessage } from '../util/errors'
import type { ListType } from '../list/list-type'

/**
 * The basenames the site's selection config includes for one list kind — the
 * live server's answer to what `build-site` resolves at build time.
 *
 * Never throws: discovery already reports a missing list directory as an empty
 * category, and anything it does let through (permissions, I/O) is logged
 * rather than taking the server down.
 */
export async function enumerateSources(kind: ListType, config: RitualConfig): Promise<string[]> {
  const selection = getSiteSelectionConfig(config.site)
  const dir = dirForType(kind, config)
  try {
    if (kind === 'deck') {
      return await resolveDeckSources(dir, selection.includeDecks, selection.excludeDecks)
    }
    if (kind === 'collection') {
      return await resolveListSources(
        dir,
        selection.includeCollections,
        selection.excludeCollections,
      )
    }
    return await resolveListSources(dir, selection.includeWantedLists, selection.excludeWantedLists)
  } catch (e) {
    console.warn(`Failed to enumerate ${kind} sources: ${getErrorMessage(e)}`)
    return []
  }
}
