/**
 * The `&N` card id readers — the leaf of the card-line grammar.
 *
 * Its own module, deliberately: `card-id.ts` ships in the browser bundles and
 * sits behind the card-line persistence fence, and it needs nothing from the
 * tokenizer but this. Importing the whole grammar for one regex would drag the
 * label, language, and condition vocabularies (and their `src/i18n` edges) into
 * every bundle that only wants to read an id.
 *
 * **Two readers, two widths, on purpose.** {@link readCardId} is what the
 * tokenizer reads: an id must stand at a whitespace boundary, so a card named
 * `Bebop & Rocksteady` never yields one. {@link readAnyCardId} is what seeds the
 * id pool, and is deliberately *wider*: a glued `- Sol Ring (LEA:2)&2` is not an
 * id the entry parser will report, but the pool must still treat 2 as spoken
 * for. Over-reserving costs one id; under-reserving hands a live id to a second
 * card, which is silent data loss.
 *
 * English by construction and browser-safe: no `src/i18n`, no `node:`.
 */

/** The digits of a trailing `&N`, with no boundary requirement. */
const ANY_CARD_ID_RE = /&(\d+)\s*$/

/**
 * A trailing `&N` at a whitespace boundary (or at the very start of the line),
 * so a name's own `&` is never mistaken for an id.
 */
const CARD_ID_RE = /(?:^|\s)&(\d+)\s*$/

/** Where a line's `&N` sits and how it was written. */
export type CardIdMatch = {
  id: number
  /** The token exactly as written, e.g. `&12` — `&007` is not `&7`. */
  text: string
  /** 0-based index of the `&` in the line. */
  index: number
}

/** The id `pattern` finds at the end of `line`, if any. */
function matchWith(pattern: RegExp, line: string): CardIdMatch | undefined {
  const match = pattern.exec(line)
  if (match?.[1] === undefined || match.index === undefined) return undefined
  const text = `&${match[1]}`
  return { id: Number.parseInt(match[1], 10), text, index: match.index + match[0].indexOf('&') }
}

/**
 * The trailing `&N` of a card line, with its exact text and position — what the
 * tokenizer needs and {@link readCardId} throws away.
 */
export function matchCardId(line: string): CardIdMatch | undefined {
  return matchWith(CARD_ID_RE, line)
}

/**
 * The `&N` card id a line carries, or `undefined` — the id the *entry* parser
 * reads. `parseCardLine` uses exactly this rule (and only in the line's final
 * token position), so the two can never disagree about the id an entry has.
 */
export function readCardId(line: string): number | undefined {
  return matchCardId(line)?.id
}

/**
 * Every `&N`-shaped suffix, boundary or not — the id-*pool* reader. See the
 * module docstring: the seeder must be at least as wide as the entry parser,
 * because an id it fails to see is an id it will hand out twice.
 */
export function readAnyCardId(line: string): number | undefined {
  return matchWith(ANY_CARD_ID_RE, line)?.id
}
