/**
 * The quantity token of a card line, both halves: the reader that decides when
 * a leading digit run *is* a quantity, and the writer that spells a quantity so
 * the reader takes it back. One module so the two cannot drift apart — a writer
 * that emitted `- 1234 Sol Ring` while the reader capped bare quantities read
 * the line back as one copy of a card named "1234 Sol Ring".
 *
 * English by construction, like the rest of the card-line grammar: the `x`
 * marker is matched literally, so this module must never import `src/i18n`
 * (the line fence in `test/unit/i18n-conventions.test.ts`). Browser-safe, and it
 * loads nothing at run time.
 */

/**
 * The marker that says "quantity" out loud: `4x Sol Ring`. Written lowercase;
 * read in either case (`10X Sol Ring`).
 */
export const QUANTITY_MARKER = 'x'

/**
 * The longest digit run the reader takes as a quantity *without* a
 * {@link QUANTITY_MARKER}: `999 Sol Ring` is 999 copies, while
 * `1996 World Champion` is a card name. A marker (`1996x Sol Ring`) lifts the
 * cap, and the writer adds one to any quantity past it.
 */
export const BARE_QUANTITY_MAX_DIGITS = 3

/** The marker in either case, as a regex character class. */
const MARKER_CLASS = `[${QUANTITY_MARKER}${QUANTITY_MARKER.toUpperCase()}]`

/**
 * The quantity token's pattern — digits, then an optional marker in either
 * case — as regex source, for the patterns that embed it (the deck-line
 * candidate test in `card-line-read.ts`).
 */
export const QUANTITY_PATTERN = `\\d+${MARKER_CLASS}?`

/** A leading quantity token and the whitespace that ends it. */
const QUANTITY_RE = new RegExp(`^(\\d+)(${MARKER_CLASS})?\\s+`)

/** A leading quantity token, as read off the start of a line. */
export type QuantityToken = {
  /**
   * The copies it names. Not yet validated: `0`, or a run too long to be a
   * safe integer, is the caller's to refuse.
   */
  value: number
  /** The token exactly as written, digits plus any marker: `4`, `1234x`, `10X`. */
  text: string
  /** How many characters it spans, the whitespace after it included. */
  length: number
}

/** Whether a run of `digits` with no marker reads as a quantity. */
function isBareQuantity(digits: string): boolean {
  return digits.length <= BARE_QUANTITY_MAX_DIGITS
}

/**
 * Read the quantity token `text` starts with, or `undefined` when it starts
 * with none — no digits, digits that run into the name (`4Sol Ring`), or a
 * digit run past {@link BARE_QUANTITY_MAX_DIGITS} with no marker, which is the
 * start of a card name (`1996 World Champion`).
 */
export function readQuantityToken(text: string): QuantityToken | undefined {
  const match = QUANTITY_RE.exec(text)
  const digits = match?.[1]
  if (match === null || digits === undefined) return undefined
  const marker = match[2]
  if (marker === undefined && !isBareQuantity(digits)) return undefined
  return { value: Number(digits), text: digits + (marker ?? ''), length: match[0].length }
}

/**
 * Whether a card line can carry `quantity`: a whole number of copies, at least
 * one, small enough to be read back exactly.
 */
export function isWritableQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0
}

/**
 * The quantity token as a card line spells it: bare (`2`, `999`) while the
 * reader takes it bare, marked (`1000x`, `1234x`) once it would otherwise read
 * back as part of the card name. Digits are never grouped or localized —
 * `1,234` and `1.234` are not quantities the reader accepts.
 *
 * **Precondition:** {@link isWritableQuantity}`(quantity)`. This module loads
 * nothing, so it cannot word a refusal; the canonical line writer
 * (`formatCanonicalCardLine`) checks and refuses before calling here. The text
 * exports (`plainTextCardLine`, the dialects) are handed aggregated counts of
 * cards that already loaded, which hold it by construction.
 */
export function formatQuantityToken(quantity: number): string {
  const digits = String(quantity)
  return isBareQuantity(digits) ? digits : `${digits}${QUANTITY_MARKER}`
}
