import { unreadableLines } from '../../markdown-fence'
import { parseWantedListFile } from '../../commands/wanted-helpers'
import { readListDescription } from '../../list-description'
import { readListImage } from '../../list-image'
import type { ParsedWantedEntry } from '../../editor/wanted-entries'
import { getWantedDir } from '../../ritual-config'
import { handleFlatListLoad, type FlatListLoadConfig, type FlatListParseResult } from './list-load'

const WANTED_LOAD_CFG: FlatListLoadConfig<ParsedWantedEntry> = {
  label: 'wanted list',
  getDir: getWantedDir,
  // Name-only entries are a wanted list's own state, and the only lines a price
  // store's printing pick can apply to.
  resolvesByName: true,
  parse: (content): FlatListParseResult<ParsedWantedEntry> => {
    const parsed = parseWantedListFile(content)
    return {
      entries: parsed.entries,
      sectionOrder: parsed.sectionOrder,
      // A wanted list's two front-matter keys — see `collection-load.ts` for why
      // they are read here rather than in the parser, and why an unusable value
      // is dropped without an advisory.
      description: readListDescription(parsed.frontMatter?.data ?? {}).description,
      image: readListImage(parsed.frontMatter?.data ?? {}).image,
      // Fenced code blocks join the parse warnings — see `deck-load.ts`.
      warnings: unreadableLines(parsed),
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
