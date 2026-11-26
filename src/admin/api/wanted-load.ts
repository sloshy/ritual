import { unreadableMessages } from '../../list/unreadable-content'
import { parseWantedListFile } from '../../list/wanted-file'
import { flatListLoadMetadata } from './list-load'
import type { ParsedWantedEntry } from '../../list/wanted-entries'
import { getWantedDir } from '../../config/ritual-config'
import { handleFlatListLoad, type FlatListLoadConfig, type FlatListParseResult } from './list-load'

const WANTED_LOAD_CFG: FlatListLoadConfig<ParsedWantedEntry> = {
  listType: 'wanted',
  getDir: getWantedDir,
  // Name-only entries are a wanted list's own state, and the only lines a price
  // store's printing pick can apply to.
  resolvesByName: true,
  parse: (content): FlatListParseResult<ParsedWantedEntry> => {
    const parsed = parseWantedListFile(content)
    return {
      entries: parsed.entries,
      sectionOrder: parsed.sectionOrder,
      // A wanted list's two front-matter keys — see `collection-load.ts`.
      ...flatListLoadMetadata(parsed.frontMatter?.data),
      // Fenced code blocks join the parse warnings — see `deck-load.ts`.
      warnings: unreadableMessages(parsed),
    }
  },
}

/**
 * `GET /api/wanted/:slug` — a wanted list, at the depth `?view=` asks for.
 * See `deck-load.ts` for the view/filter contract, which is identical.
 */
export function handleWantedListLoad(req: Request): Promise<Response> {
  return handleFlatListLoad(req, WANTED_LOAD_CFG)
}
