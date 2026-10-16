/**
 * What the card-line grammar has to say about a line — why it refused it, how
 * it read it, what to do next — as a **structured value**, not a sentence.
 *
 * The grammar (`card-line-grammar.ts`) is English by construction and may
 * never import `src/i18n` (AGENTS.md, "Card-line grammar is not prose"; the
 * fence scan in `test/unit/i18n-conventions.test.ts`), yet its diagnostics are
 * read by people — on the CLI, in the admin site — and by agents over MCP. So
 * the grammar says *what* it found as a code plus the values the sentence
 * needs (the offending token, the line, the list type), and the boundary that
 * shows it words it: `card-line-message.ts` maps each code to its catalog key
 * and renders the text in English (the `warnings` channel, the API, MCP) or in
 * the reader's language (the CLI, the SPAs).
 *
 * Two kinds of text:
 *
 * - a **detail** is the diagnostic itself (`Unrecognized token [jp].`);
 * - a **hint** is the next step a refusal suggests (`did you mean [ja]?`).
 *
 * The values are the line's own bytes and the format's own vocabulary — a
 * token exactly as written, a token kind, a label, a finish, a language code —
 * never prose, so they read the same in every language.
 *
 * **Line-grammar fence — this module must never import `src/i18n`** (asserted
 * by `test/unit/i18n-conventions.test.ts`). Type-only imports, nothing at run
 * time: the grammar imports it.
 */

import type { CardLabel } from './card-labels'
import type { CardLanguage } from './card-language'
import type { TokenKind } from './card-line-grammar'
import type { Finish } from './finish-condition'
import type { ListType } from '../list/list-type'

/** Codes for the diagnostic itself — a refusal's reason, or an advisory's note. */
export const CARD_LINE_DETAIL_CODES = [
  'blank-line',
  'not-a-card-line',
  'zero-quantity',
  'quantity-expanded-collection',
  'quantity-expanded-wanted',
  'token-not-allowed',
  'wanted-condition',
  'wanted-labels',
  'duplicate-token',
  'labels-exclusive',
  'labels-contradictory',
  'unknown-token',
  'malformed-tag',
  'unclosed-note',
  'empty-name',
  'unseparated-token',
  'misplaced-token',
  'missing-printing',
  'export-finish-marker',
  'export-printing',
  'export-printing-finish',
  'suspect-printing-in-name',
] as const

/** Codes for the next step a refusal suggests. */
export const CARD_LINE_HINT_CODES = [
  'did-you-mean',
  'insert-space',
  'id-last',
  'move-after-name',
] as const

/** Every card-line text code, detail and hint. */
export const CARD_LINE_TEXT_CODES = [...CARD_LINE_DETAIL_CODES, ...CARD_LINE_HINT_CODES] as const

export type CardLineDetailCode = (typeof CARD_LINE_DETAIL_CODES)[number]
export type CardLineHintCode = (typeof CARD_LINE_HINT_CODES)[number]
export type CardLineTextCode = (typeof CARD_LINE_TEXT_CODES)[number]

/** The detail and hint codes never share a code: a code says which kind it is. */
type CodesOverlap = Extract<CardLineDetailCode, CardLineHintCode>
const CODES_DISJOINT: [CodesOverlap] extends [never] ? true : CodesOverlap = true
void CODES_DISJOINT

/** A code that carries no values. */
type NoParams = Record<never, never>

/** Which side of a token glued to its neighbour the missing space belongs on. */
export type SpaceSide = 'after' | 'before'

/**
 * What each code carries. `token` is the offending token exactly as written,
 * `line` the trimmed line; `printing` is the `SET:CN` label a dialect printing
 * was read as. A `count` is the number of copies a pasted quantity names.
 */
export type CardLineTextParams = {
  'blank-line': NoParams
  'not-a-card-line': { line: string }
  'zero-quantity': NoParams
  'quantity-expanded-collection': { count: number }
  'quantity-expanded-wanted': { count: number }
  'token-not-allowed': { token: string; listType: ListType }
  'wanted-condition': { token: string }
  'wanted-labels': { token: string }
  'duplicate-token': { token: string; kind: TokenKind }
  'labels-exclusive': { token: string; label: CardLabel }
  'labels-contradictory': { token: string; label: CardLabel }
  'unknown-token': { token: string }
  'malformed-tag': { token: string }
  'unclosed-note': NoParams
  'empty-name': { line: string }
  'unseparated-token': { token: string }
  'misplaced-token': { token: string }
  'missing-printing': { line: string; listType: ListType }
  'export-finish-marker': { token: string; finish: Finish }
  'export-printing': { token: string; printing: string }
  'export-printing-finish': { token: string; printing: string; finish: Finish }
  'suspect-printing-in-name': { line: string }
  'did-you-mean': { language: CardLanguage }
  'insert-space': { token: string; side: SpaceSide }
  'id-last': NoParams
  'move-after-name': { token: string }
}

/** A params row per code, and no row that is not a code. */
type ParamsCoverCodes = [keyof CardLineTextParams] extends [CardLineTextCode]
  ? [CardLineTextCode] extends [keyof CardLineTextParams]
    ? true
    : never
  : never
const PARAMS_COVER_CODES: ParamsCoverCodes = true
void PARAMS_COVER_CODES

/** One piece of card-line text: a code and the values it needs. */
export type CardLineText = {
  [C in CardLineTextCode]: { code: C; params: CardLineTextParams[C] }
}[CardLineTextCode]

/** The text a code picks out of {@link CardLineText}. */
type WithCode<C> = { code: C }

/** A diagnostic's own text. */
export type CardLineDetail = Extract<CardLineText, WithCode<CardLineDetailCode>>

/** A refusal's suggested next step. */
export type CardLineHint = Extract<CardLineText, WithCode<CardLineHintCode>>

/** The text with code `C`. */
export type CardLineTextOf<C extends CardLineTextCode> = Extract<CardLineText, WithCode<C>>

/** Whether `T` is a union of more than one member. */
type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never

/**
 * `[]` for a code that carries nothing, `[params]` otherwise — for one literal
 * code at a time. A union of codes is refused outright (`[never]`): over codes
 * whose params share no key, `keyof` would collapse to `never` and let the
 * call compile with no params at all. Pick the code with a ternary of two
 * calls instead.
 */
type ParamsArgs<C extends CardLineTextCode> =
  true extends IsUnion<C>
    ? [never]
    : [keyof CardLineTextParams[C]] extends [never]
      ? []
      : [params: CardLineTextParams[C]]

/** Build a {@link CardLineText}. */
export function lineText<C extends CardLineTextCode>(
  code: C,
  ...args: ParamsArgs<C>
): CardLineTextOf<C> {
  const [params = {}] = args as readonly [CardLineTextParams[C]?]
  return { code, params } as CardLineTextOf<C>
}
