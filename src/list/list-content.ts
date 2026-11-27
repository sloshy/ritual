/**
 * A list file's content parsed once, whatever its type — the one parse a
 * reader that needs both a list's counts and its prices shares, so the two can
 * never describe different readings of the file.
 *
 * Reading the file is the caller's job: a caller already holding the content
 * parses exactly the text it has, and never reads the file a second time.
 */

import { parseDeckText, type DeckParseResult } from '../importers/text-file'
import { SyncMessageError } from '../sync/message'
import { hasErrorCode } from '../util/errno'
import { parseCollectionFile, type CollectionParseResult } from './collection-file'
import { deckFrontMatterFromText, type DeckFrontMatter } from './deck-file'
import type { ListInfo } from './list-identity'
import { listDisplayNameFromContent } from './list-display-name'
import { listSlug } from './list-file-name'
import type { ListType } from './list-type'
import { parseWantedListFile, type WantedListParseResult } from './wanted-file'

/** A deck's parse, plus its validated front matter (which the deck body does not carry). */
export type ParsedDeckContent = ListInfo & {
  listType: 'deck'
  parse: DeckParseResult
  frontMatter: DeckFrontMatter
}

/** A collection's parse. */
export type ParsedCollectionContent = ListInfo & {
  listType: 'collection'
  parse: CollectionParseResult
}

/** A wanted list's parse. */
export type ParsedWantedContent = ListInfo & {
  listType: 'wanted'
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
  const identity: Omit<ListInfo, 'listType'> = {
    slug: listSlug(filePath),
    name: listDisplayNameFromContent(content, filePath),
  }
  switch (type) {
    case 'deck':
      return {
        ...identity,
        listType: type,
        parse: parseDeckText(content, identity.slug),
        // The deck body carries no front matter; the block is read the way the
        // deck load route reads it, for the labels, cover and format it validates.
        frontMatter: deckFrontMatterFromText(content),
      }
    case 'collection':
      return { ...identity, listType: type, parse: parseCollectionFile(content) }
    case 'wanted':
      return { ...identity, listType: type, parse: parseWantedListFile(content) }
  }
}

/** A parsed list's {@link ListInfo}, without its parse. */
export function parsedListInfo({ listType, slug, name }: ParsedListContent): ListInfo {
  return { listType, slug, name }
}

/**
 * The failures reading a list file is expected to meet: an engine refusal, a
 * front-matter block that is not YAML, or the file system refusing the read
 * (gone since it was listed, a directory, no permission). Anything else is a
 * bug, which a reader that tolerates unreadable lists must rethrow rather than
 * report as one.
 */
export function isExpectedListReadFailure(error: unknown): boolean {
  if (error instanceof SyncMessageError) return true
  if (error instanceof Error && error.name === 'YAMLException') return true
  return (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'] as const).some((code) =>
    hasErrorCode(error, code),
  )
}
