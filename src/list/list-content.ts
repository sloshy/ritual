/**
 * A list file's content parsed once, whatever its type — the one parse a
 * reader that needs both a list's counts and its prices shares, so the two can
 * never describe different readings of the file.
 *
 * Reading the file is the caller's job: a caller already holding the content
 * parses exactly the text it has, and never reads the file a second time.
 */

import { parseDeckText, type DeckParseResult } from '../importers/text-file'
import { parseCollectionFile, type CollectionParseResult } from './collection-file'
import { deckFrontMatterFromText, type DeckFrontMatter } from './deck-file'
import type { ListInfo } from './list-info'
import { listDisplayNameFromContent } from './list-display-name'
import { listSlug } from './list-file-name'
import type { ListType } from './list-type'
import { parseWantedListFile, type WantedListParseResult } from './wanted-file'

/** Who a parsed list is: its slug and display name (its type is on each arm). */
type ParsedListIdentity = Omit<ListInfo, 'type'>

/** A deck's parse, plus its validated front matter (which the deck body does not carry). */
export type ParsedDeckContent = ParsedListIdentity & {
  type: 'deck'
  parse: DeckParseResult
  frontMatter: DeckFrontMatter
}

/** A collection's parse. */
export type ParsedCollectionContent = ParsedListIdentity & {
  type: 'collection'
  parse: CollectionParseResult
}

/** A wanted list's parse. */
export type ParsedWantedContent = ParsedListIdentity & {
  type: 'wanted'
  parse: WantedListParseResult
}

/** A list file's content, parsed by its type's parser. */
export type ParsedListContent = ParsedDeckContent | ParsedCollectionContent | ParsedWantedContent

/**
 * Parse a list file's `content` by its `type`, naming it from the content (its
 * `# Title`, else the slug of `filePath`). Throws what the parsers throw — a
 * deck's unreadable front matter.
 */
export function parseListContent(
  type: ListType,
  content: string,
  filePath: string,
): ParsedListContent {
  const identity: ParsedListIdentity = {
    slug: listSlug(filePath),
    name: listDisplayNameFromContent(content, filePath),
  }
  switch (type) {
    case 'deck':
      return {
        ...identity,
        type,
        parse: parseDeckText(content, identity.slug),
        // The deck body carries no front matter; the block is read the way the
        // deck load route reads it, for the labels, cover and format it validates.
        frontMatter: deckFrontMatterFromText(content),
      }
    case 'collection':
      return { ...identity, type, parse: parseCollectionFile(content) }
    case 'wanted':
      return { ...identity, type, parse: parseWantedListFile(content) }
  }
}
