import { unreadableLines } from '../../list/markdown-fence'
import { parseCollectionFile } from '../../list/collection-file'
import { readListDescription } from '../../list/list-description'
import { readListImage } from '../../list/list-image'
import { getCollectionsDir } from '../../config/ritual-config'
import { handleFlatListLoad, type FlatListLoadConfig, type FlatListParseResult } from './list-load'
import type { CollectionEntry } from './load-results'

const COLLECTION_LOAD_CFG: FlatListLoadConfig<CollectionEntry> = {
  label: 'collection',
  getDir: getCollectionsDir,
  parse: (content): FlatListParseResult<CollectionEntry> => {
    const parsed = parseCollectionFile(content)
    const { entries, sectionOrder, labels, frontMatter } = parsed
    // Set codes are normalized to lowercase so they match Scryfall card keys.
    return {
      entries: entries.map((entry) => ({ ...entry, set: entry.set.toLowerCase() })),
      sectionOrder,
      labels,
      // The block round-trips verbatim, so its blurb and cover are read out of
      // the parsed mapping here rather than being interpreted by the parser
      // itself. Both readers' advisories are deliberately dropped: an unusable
      // value reads as no blurb / no override, and the site build is where the
      // user hears about it (a load body's `warnings` means "lines a save would
      // eat", which this is not).
      description: readListDescription(frontMatter?.data ?? {}).description,
      image: readListImage(frontMatter?.data ?? {}).image,
      // Fenced code blocks join the parse warnings — see `deck-load.ts`.
      warnings: unreadableLines(parsed),
    }
  },
}

/**
 * `GET /api/collection/:slug` — a collection, at the depth `?view=` asks for.
 * See `deck-load.ts` for the view/filter contract, which is identical.
 */
export function handleCollectionLoad(req: Request): Promise<Response> {
  return handleFlatListLoad(req, COLLECTION_LOAD_CFG)
}
