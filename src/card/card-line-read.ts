/**
 * Reading card lines **out of a file** — the layer between the one-line
 * tokenizer and the modules that scan a whole document.
 *
 * `parseCardLine` answers "what does this line say?" for a line somebody has
 * already decided is a card. Two questions it deliberately does not answer come
 * up in every file scan, and both are answered here so the scanners cannot
 * answer them differently:
 *
 * - **Which lines are candidates.** The bullet and the quantity are optional on
 *   read, so a paragraph of prose is a syntactically valid name-only card line.
 *   {@link isCardCandidate} is the file-level rule that keeps a deck's
 *   commentary and a collection's notes out of the card list.
 * - **How much refusal to tolerate.** The line-preserving mutation paths must
 *   still *find* a line whose labels token the grammar refuses — `set-label`
 *   exists to repair exactly that token, and a move must still be able to take
 *   the copy out. {@link readCardLine} reads such a line, reporting the bad
 *   token separately so a caller about to rewrite the line can refuse instead
 *   of silently dropping it.
 *
 * English by construction and browser-safe, like the grammar: no `src/i18n`, no
 * `node:`.
 */

import { CARD_LINE_BULLET_RE, parseCardLine, type LineTokens } from './card-line-grammar'
import type { ListType } from '../list/list-type'

/**
 * A deck card candidate: a leading quantity, optionally behind a `- ` bullet.
 *
 * Requiring the quantity is what keeps hand-written prose prose — an imported
 * decklist's commentary would otherwise become one card per sentence. The
 * optional bullet is read tolerance for the canonical write form.
 */
const DECK_CANDIDATE_RE = /^(?:-\s+)?\d+[xX]?\s+/

/**
 * Whether a **trimmed** body line is a card line candidate for `type`: a
 * quantity-led line in a deck, a `- ` bullet in a collection or wanted list.
 *
 * A candidate is a line the tokenizer should be *offered*; whether it parses is
 * the tokenizer's answer. Non-candidates are prose, and the file parsers report
 * them as such rather than inventing cards from them.
 */
export function isCardCandidate(type: ListType, trimmed: string): boolean {
  // The flat-list bullet is the tokenizer's own, not a second spelling of it:
  // a scanner that demanded `"- "` where the parser accepts `-\t` would call a
  // line the parser reads perfectly well prose, and leave it un-stamped.
  return type === 'deck' ? DECK_CANDIDATE_RE.test(trimmed) : CARD_LINE_BULLET_RE.test(trimmed)
}

/** A card line read out of a file, plus the one refusal the readers tolerate. */
export type ReadCardLine = {
  tokens: LineTokens
  /**
   * The labels token's body (`sale,keep`) when the line's labels conflict —
   * present only on a line the grammar refused and this reader recovered.
   * A caller that is about to **rewrite** the line must refuse, since the
   * rewrite would drop the token; a caller that replaces or deletes the token
   * wholesale may proceed.
   */
  invalidLabels?: string
}

/**
 * Read the card line a **trimmed** file line holds, or `undefined` when the
 * line is not a card line for `type` — prose, a heading, a comment, or a
 * candidate the grammar refused.
 *
 * The one refusal that is recovered rather than refused is
 * `conflicting-labels`: the rest of the line is perfectly readable, and a line
 * the mutation paths cannot find is a line the user cannot repair with the very
 * command that replaces the token.
 */
export function readCardLine(type: ListType, trimmed: string): ReadCardLine | undefined {
  if (!isCardCandidate(type, trimmed)) return undefined
  const parsed = parseCardLine(type, trimmed)
  if (parsed.ok) return { tokens: parsed.tokens }
  if (parsed.code !== 'conflicting-labels') return undefined
  // Cut the offending token out and read what is left: the token's exact text
  // and column come from the refusal, so nothing else in the line moves.
  const without =
    trimmed.slice(0, parsed.column) + trimmed.slice(parsed.column + parsed.token.length)
  const retry = parseCardLine(type, without)
  if (!retry.ok) return undefined
  return { tokens: retry.tokens, invalidLabels: parsed.token.slice(1, -1) }
}
