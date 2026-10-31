/**
 * The one parser for a list type typed by a person — `ritual new <type>`,
 * `import --type` — which accepts the plural and the two-word spellings a
 * newcomer reaches for (`decks`, `collections`, `wanted-lists`, a quoted
 * `"wanted lists"`) as well as the canonical tokens. It parses one token: the
 * words after an unquoted `wanted` belong to the list's name, never the type.
 *
 * Machine surfaces (the admin API's `type` fields, MCP `listType`, the
 * `deck:` / `collection:` / `wanted:` name prefix) keep the strict
 * {@link isListType} tokens: they are contracts, not typing.
 */
import { syncMessage, type MessageParseError } from '../sync/message'
import type { ListType } from './list-type'

/**
 * Every accepted spelling, keyed by its folded form ({@link foldListTypeWord}):
 * lowercase, with runs of spaces, `_` and `-` collapsed to one `-`.
 */
const LIST_TYPE_WORDS: ReadonlyMap<string, ListType> = new Map<string, ListType>([
  ['deck', 'deck'],
  ['decks', 'deck'],
  ['collection', 'collection'],
  ['collections', 'collection'],
  ['wanted', 'wanted'],
  ['wanted-list', 'wanted'],
  ['wanted-lists', 'wanted'],
  ['wantedlist', 'wanted'],
  ['wantedlists', 'wanted'],
])

function foldListTypeWord(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
}

/**
 * Parse a person-typed list type: `deck`/`decks`, `collection`/`collections`,
 * `wanted`/`wanted list`/`wanted-lists`, in any case. Anything else is refused
 * with a message naming the accepted tokens.
 */
export function parseListTypeArg(raw: string): ListType | MessageParseError {
  const type = LIST_TYPE_WORDS.get(foldListTypeWord(raw))
  if (type !== undefined) return type
  return { error: syncMessage('errors.listType.invalid', { value: raw }) }
}
