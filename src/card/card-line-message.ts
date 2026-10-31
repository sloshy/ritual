/**
 * Wording a card-line diagnostic — the boundary where the grammar's structured
 * text (`card-line-text.ts`) becomes a sentence.
 *
 * The grammar may not import `src/i18n`, so it returns a code and its values.
 * Every surface that shows one goes through here:
 *
 * - the list parsers' `warnings` / `advisories` channels, the admin API, MCP
 *   and `--output json` take {@link cardLineDiagnosticMessage} — English
 *   `message` plus the key and (nested) params, a `SyncMessage`; the English
 *   is byte for byte what the grammar used to write;
 * - the CLI renders it in its own language with {@link renderCardLineDiagnostic};
 * - the SPAs hold the message unrendered and render it in tracked JSX, so a
 *   language switch relabels it.
 *
 * Browser-safe: the list parsers both SPAs bundle record through here.
 */

import type { MessageKey } from '../i18n/messages/en'
import type { LocaleTag } from '../i18n/types'
import {
  renderSyncMessage,
  syncRef,
  toSyncMessage,
  type ParamTypeDrift,
  type PlaceholderDrift,
  type SyncMessage,
  type SyncMessageParams,
  type SyncMessageRef,
} from '../sync/message'
import { isCardLineError, type CardLineDiagnostic } from './card-line-grammar'
import { cardTagShapeRule } from './card-tags'
import type { CardLineText, CardLineTextCode, CardLineTextParams } from './card-line-text'

/** The catalog key each card-line text code is worded with. */
const TEXT_KEYS = {
  'blank-line': 'domain.card.line.blank',
  'not-a-card-line': 'domain.card.line.notACardLine',
  'zero-quantity': 'domain.card.line.zeroQuantity',
  'quantity-too-large': 'domain.card.line.quantityTooLarge',
  'quantity-expanded-collection': 'domain.card.line.quantityExpandedCollection',
  'quantity-expanded-wanted': 'domain.card.line.quantityExpandedWanted',
  'token-not-allowed': 'domain.card.line.tokenNotAllowed',
  'wanted-condition': 'domain.card.line.wantedCondition',
  'wanted-labels': 'domain.card.line.wantedLabels',
  'duplicate-token': 'domain.card.line.duplicateToken',
  'labels-exclusive': 'domain.card.line.labelsExclusive',
  'labels-contradictory': 'domain.card.line.labelsContradictory',
  'unknown-token': 'domain.card.line.unknownToken',
  'malformed-tag': 'domain.card.line.malformedTag',
  'unclosed-note': 'domain.card.line.unclosedNote',
  'empty-name': 'domain.card.line.emptyName',
  'unseparated-token': 'domain.card.line.unseparatedToken',
  'misplaced-token': 'domain.card.line.misplacedToken',
  'missing-printing': 'domain.card.line.missingPrinting',
  'export-finish-marker': 'domain.card.line.exportFinishMarker',
  'export-printing': 'domain.card.line.exportPrinting',
  'export-printing-finish': 'domain.card.line.exportPrintingFinish',
  'suspect-printing-in-name': 'domain.card.line.suspectPrintingInName',
  'did-you-mean': 'domain.card.line.hint.didYouMean',
  'insert-space': 'domain.card.line.hint.insertSpace',
  'id-last': 'domain.card.line.hint.idLast',
  'move-after-name': 'domain.card.line.hint.moveAfterName',
} as const satisfies Record<CardLineTextCode, MessageKey>

/**
 * The values a code's sentence needs that the grammar does not carry, because
 * they are the same for every line: the tag shape rule (a message of its own)
 * and the literal `{note}` syntax, which a catalog string cannot spell (braces
 * there mark a placeholder).
 */
type FixedParams = {
  'malformed-tag': { rule: SyncMessageRef }
  'unclosed-note': { syntax: string }
}

/** The literal note syntax `unclosed-note` quotes. */
// i18n-exempt: card-line syntax, quoted verbatim inside the sentence
const NOTE_SYNTAX = '{note}'

/** One builder per {@link FixedParams} code, returning that code's values. */
type FixedParamBuilders = { [C in keyof FixedParams]: () => FixedParams[C] }

/**
 * {@link FixedParams} at run time: one builder per code, typed by the same
 * table, so the values a code adds and the type the checks below read cannot
 * drift apart.
 */
const FIXED_PARAMS: FixedParamBuilders = {
  'malformed-tag': () => ({ rule: cardTagShapeRule() }),
  'unclosed-note': () => ({ syntax: NOTE_SYNTAX }),
}

/** The fixed values a code adds, or nothing. */
type FixedParamsOf<C extends CardLineTextCode> = C extends keyof FixedParams
  ? FixedParams[C]
  : Record<never, never>

/** Whether `code` is one {@link FIXED_PARAMS} adds values to. */
function hasFixedParams(code: CardLineTextCode): code is keyof FixedParams {
  return Object.hasOwn(FIXED_PARAMS, code)
}

/**
 * Compile-time agreement between each code's params (plus its fixed ones) and
 * its key's placeholders — names and types — the checks `syncRef` makes per
 * call, which a lookup by code cannot.
 */
type ExpectedParams = {
  [C in CardLineTextCode]: keyof CardLineTextParams[C] | keyof FixedParamsOf<C>
}
type GivenParams = { [C in CardLineTextCode]: CardLineTextParams[C] & FixedParamsOf<C> }
type ParamsDrift = PlaceholderDrift<CardLineTextCode, typeof TEXT_KEYS, ExpectedParams>
const PARAMS_AGREE: [ParamsDrift] extends [never] ? true : ParamsDrift = true
void PARAMS_AGREE
type ParamTypesDrift = ParamTypeDrift<CardLineTextCode, typeof TEXT_KEYS, GivenParams>
const PARAM_TYPES_AGREE: [ParamTypesDrift] extends [never] ? true : ParamTypesDrift = true
void PARAM_TYPES_AGREE

/** The values {@link FixedParams} adds to `text`, if any. */
function fixedParams(text: CardLineText): SyncMessageParams {
  return hasFixedParams(text.code) ? FIXED_PARAMS[text.code]() : {}
}

/** One piece of card-line text as an unrendered message: its key and its values. */
export function cardLineTextRef(text: CardLineText): SyncMessageRef {
  const params: SyncMessageParams = { ...text.params, ...fixedParams(text) }
  // The params were checked against the key's placeholders above
  // (`PARAMS_AGREE`), which is what `syncRef` would otherwise check per call.
  return Object.keys(params).length === 0
    ? { messageKey: TEXT_KEYS[text.code] }
    : { messageKey: TEXT_KEYS[text.code], messageParams: params }
}

/** A diagnostic as an unrendered message: its text, followed by its hint when it has one. */
export function cardLineDiagnosticRef(diagnostic: CardLineDiagnostic): SyncMessageRef {
  const text = cardLineTextRef(diagnostic.detail)
  if (!isCardLineError(diagnostic) || diagnostic.hint === undefined) return text
  return syncRef('domain.card.line.withHint', {
    text,
    hint: cardLineTextRef(diagnostic.hint),
  })
}

/** Where a diagnostic was found. `file` is optional — pasted text has none. */
export type CardLineDiagnosticLocation = {
  file?: string
  /** 1-based line number. */
  line: number
}

/**
 * A diagnostic with its location — `decks/burn.md:12: …` when the file is
 * known, `line 12: …` when it is not — as an unrendered message.
 */
export function locatedCardLineDiagnosticRef(
  diagnostic: CardLineDiagnostic,
  where: CardLineDiagnosticLocation,
): SyncMessageRef {
  const text = cardLineDiagnosticRef(diagnostic)
  return where.file === undefined
    ? syncRef('domain.card.line.atLine', { line: where.line, text })
    : syncRef('domain.card.line.inFile', { file: where.file, line: where.line, text })
}

/**
 * A diagnostic as English plus its key and params — what the parsers' string
 * channels, an API response or MCP carry. Located when `where` is given.
 */
export function cardLineDiagnosticMessage(
  diagnostic: CardLineDiagnostic,
  where?: CardLineDiagnosticLocation,
): SyncMessage {
  return toSyncMessage(
    where === undefined
      ? cardLineDiagnosticRef(diagnostic)
      : locatedCardLineDiagnosticRef(diagnostic, where),
  )
}

/**
 * A diagnostic in `locale` — the active UI locale by default, read reactively
 * inside a Solid component's JSX. Located when `where` is given.
 */
export function renderCardLineDiagnostic(
  diagnostic: CardLineDiagnostic,
  where?: CardLineDiagnosticLocation,
  locale?: LocaleTag,
): string {
  return renderSyncMessage(
    where === undefined
      ? cardLineDiagnosticRef(diagnostic)
      : locatedCardLineDiagnosticRef(diagnostic, where),
    locale,
  )
}
