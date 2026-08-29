/**
 * The **write** half of the card-line grammar: the one place that turns a set
 * of card-line tokens back into the canonical text a list file holds.
 *
 * Every list type writes the same token tail in the same order, so a single
 * {@link formatTokenTail} answers for all of them — the deck serializer, the
 * collection and wanted-list serializers, and the changelog's printing
 * annotations, which quote a card line back at the user and must therefore
 * spell it identically.
 *
 * English by construction, like {@link module:card-line-grammar}: `[foil]`,
 * `[NM]`, `[ja]` and `SET:CN` are matched literally by the parser, so this
 * module must never import `src/i18n` (see AGENTS.md, "Card-line grammar is not
 * prose", and the fence scan in `test/unit/i18n-conventions.test.ts`).
 * Browser-safe: no `node:` imports.
 */

import type { CardPrinting } from './card-line'
import { formatCardLabels, type CardLabel } from './card-labels'
import { languageToken, type CardLanguage } from './card-language'
import type { ConditionUpdate, Finish } from './finish-condition'
import type { ListType } from '../list/list-type'

/**
 * The `SET:CN` display form of a printing — set code uppercased, collector
 * number verbatim, **no** parentheses. The home of that form: the CLI prompts,
 * the price reports, the site labels and the card line itself all render a
 * printing through here rather than spelling `` `${set.toUpperCase()}:${cn}` ``
 * again. (A handful of hand-written copies survive in the SPA pages and
 * `printing-pin.ts`; they render identically and are being swapped as they are
 * touched. The deliberately *different* set-only form — `(LEA)` with no
 * collector number, in the Archidekt client and `ritual diff` — is not this and
 * must not be folded into it.)
 *
 * Set codes are lowercase in memory and uppercase in files and on screen
 * (AGENTS.md, "Set Code Normalization"), and this is where that half of the
 * rule is applied.
 */
export function printingLabel(set: string, collectorNumber: string): string {
  return `${set.toUpperCase()}:${collectorNumber}`
}

/**
 * The fields {@link formatTokenTail} writes.
 *
 * Every field is typed to its vocabulary, not to `string`: this writes a file
 * the tokenizer reads back, so a value outside the vocabulary would serialize a
 * token `parseCardLine` then refuses. Callers holding looser data — the
 * changelog's string-bag events, parsed from `.changes.md` — narrow at their own
 * boundary with `isFinish` / `isCondition` / `isCardLanguage`.
 */
export type CardLineTailFields = {
  printing?: CardPrinting
  /** Omitted when `nonfoil` (the bare-line default). */
  finish?: Finish
  /**
   * Omitted when `NM` (the default) or `NONE` — the changelog's "grade cleared"
   * sentinel, which is why this is `ConditionUpdate` rather than `Condition`.
   */
  condition?: ConditionUpdate
  /** Omitted when `en` — a bare line always means English. */
  language?: CardLanguage
  /** Written only when non-empty; an absent override inherits the list default. */
  labels?: readonly CardLabel[]
  note?: string
  cardId?: number
}

/**
 * The canonical token tail of a card line — everything after the name:
 * ` (LEA:161) [foil] [LP] [ja] [sale,trade] {note} &12`, with a leading space
 * before each token present and the empty string when there are none.
 *
 * The order is the canonical write order and is not negotiable: printing,
 * finish, condition, language, labels, ⟨reserved `#tag` slot⟩, note, id. Tokens
 * at their defaults are omitted, which is what makes an ordinary line read
 * `- Sol Ring (LEA:270)` rather than `- Sol Ring (LEA:270) [nonfoil] [NM] [en]`.
 *
 * A printing is a *pair* — `CardPrinting` cannot hold half of one (see
 * `resolvePrinting`) — so there is no way to write a set with no collector
 * number here.
 */
export function formatTokenTail(fields: CardLineTailFields): string {
  const { printing, finish, condition, language, labels, note, cardId } = fields
  let tail = ''
  if (printing) tail += ` (${printingLabel(printing.set, printing.collectorNumber)})`
  if (finish && finish !== 'nonfoil') tail += ` [${finish}]`
  // `NONE` clears the grade and `NM` is the unrecorded default: neither is
  // written, so a changelog annotation reads exactly like the line it produced.
  if (condition && condition !== 'NM' && condition !== 'NONE') tail += ` [${condition}]`
  tail += languageToken(language)
  if (labels && labels.length > 0) tail += ` [${formatCardLabels(labels)}]`
  // ⟨tag slot⟩ — reserved for the future `#tag` tokens, which are written
  // between the labels and the note. Nothing else may go here.
  if (note) tail += ` {${note}}`
  if (cardId !== undefined) tail += ` &${cardId}`
  return tail
}

/** A card line's fields: {@link CardLineTailFields} plus the name. */
export type CardLineFields = CardLineTailFields & { name: string }

/**
 * A deck line's fields. Copies live on the line, so a deck line — and only a
 * deck line — carries a quantity.
 */
export type DeckCardLineFields = CardLineFields & { quantity?: number }

/**
 * A flat list's fields: one bullet per copy, so `quantity` is `never` rather
 * than merely absent. Excess-property checks only fire on object *literals*, so
 * an optional-absent field would let a `LineTokens`-shaped variable through and
 * silently drop the copies it declared.
 */
export type FlatCardLineFields = CardLineFields & { quantity?: never }

/**
 * The canonical text of one card line of `type`, with no trailing newline.
 *
 * Every list type is written as a markdown list item — the `- ` bullet is
 * mandatory on write for all three, and optional on read — so a list file
 * renders as a list wherever markdown is rendered. Deck lines carry their
 * copies as a quantity (`- 2 Sol Ring (C21:263) &4`); collection and wanted
 * lines are one bullet per copy (`- Sol Ring (LEA:270) &4`). The overloads make
 * that structural: a flat list cannot be handed a `quantity` this function
 * would silently drop — the caller must expand the copies into that many lines
 * instead.
 *
 * This is the **only** writer of a canonical card line. The bulletless
 * `N Name (SET) CN` forms other sites import are export *dialects*, rendered by
 * `src/export/dialects.ts`, and are deliberately not this function's business.
 */
export function formatCanonicalCardLine(type: 'deck', fields: DeckCardLineFields): string
export function formatCanonicalCardLine(
  type: 'collection' | 'wanted',
  fields: FlatCardLineFields,
): string
export function formatCanonicalCardLine(type: ListType, fields: DeckCardLineFields): string {
  const head = type === 'deck' ? `- ${fields.quantity ?? 1} ${fields.name}` : `- ${fields.name}`
  return head + formatTokenTail(fields)
}
