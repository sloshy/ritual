/**
 * Card labels: the owner's declared intent for collection cards — `sale` ("For
 * sale") and `trade` ("For trade"), which combine, or `keep` ("To keep"), which
 * stands alone. A collection list declares a default in its front matter
 * (`labels: [sale, trade]`), and an individual card line may override it with a
 * bracketed token (`[keep]`, `[sale,trade]`); the override *replaces* the
 * default, it never merges with it.
 *
 * Labels are a collection-only concept: deck and wanted-list entries never
 * carry them and read as unlabeled everywhere.
 *
 * Layer-neutral on purpose (like {@link module:parse-enum}): the same
 * vocabulary, canonical ordering, and keep-exclusivity rule are asked for by
 * the file parsers, the CLI flags, the HTTP bodies, and the site UI, and must
 * answer identically in each.
 */

import { parseEnumField } from './parse-enum'

/** Every label, in canonical serialization order (`sale` before `trade`). */
export const CARD_LABELS = ['sale', 'trade', 'keep'] as const

/**
 * A single card label. `sale` and `trade` combine; `keep` stands alone.
 * Derived from {@link CARD_LABELS} so the runtime list and the type can never
 * drift — every schema, regex assertion, and canonical ordering hangs off it.
 */
export type CardLabel = (typeof CARD_LABELS)[number]

/** Human wording for each label, used by every display surface. */
export const CARD_LABEL_DISPLAY_NAMES: Record<CardLabel, string> = {
  sale: 'For sale',
  trade: 'For trade',
  keep: 'To keep',
}

/** True when `value` is a member of the label vocabulary. */
export function isCardLabel(value: string): value is CardLabel {
  return (CARD_LABELS as readonly string[]).includes(value)
}

/**
 * One selectable value when *filtering* by label: a card label, or `'none'`
 * for cards whose effective label set is empty. A selection selects, it does
 * not declare — so unlike the label vocabulary itself, a selection may combine
 * `keep` with the others (the export filter allows it; the site's chips
 * additionally choose to keep `keep`/`none` exclusive for UI symmetry with the
 * declaration rules).
 */
export type CardLabelSelection = CardLabel | 'none'

/** The "unlabeled" selection value. */
export const CARD_LABEL_SELECTION_NONE = 'none'

/** Every selection value, in canonical order. */
export const CARD_LABEL_SELECTIONS = [
  ...CARD_LABELS,
  CARD_LABEL_SELECTION_NONE,
] as const satisfies readonly CardLabelSelection[]

/** True when `value` is a member of the selection vocabulary. */
export function isCardLabelSelection(value: string): value is CardLabelSelection {
  return value === CARD_LABEL_SELECTION_NONE || isCardLabel(value)
}

/**
 * Match a card's effective labels against a selection (logical OR): any
 * selected label present keeps the card, and `'none'` keeps unlabeled cards.
 * The one predicate behind the site's Labels chips and the export `--labels`
 * filter, so the two can never disagree about what a selection means.
 */
export function matchesCardLabelSelection(
  labels: readonly CardLabel[],
  selection: readonly CardLabelSelection[],
): boolean {
  return selection.some((value) =>
    value === CARD_LABEL_SELECTION_NONE ? labels.length === 0 : labels.includes(value),
  )
}

/**
 * The outcome of parsing a label set: the normalized labels, or why the input
 * was refused. Refusals carry prose ready for whichever error channel the
 * caller owns (commander throw, 400 body, parse warning).
 */
export type CardLabelsResult = { ok: true; labels: CardLabel[] } | { ok: false; message: string }

/**
 * Dedupe and order a label set canonically (`sale,trade`, never `trade,sale`).
 * Pure normalization — exclusivity is the parsers' job, so an already-validated
 * set can be re-normalized without re-deciding whether it was legal.
 */
export function normalizeCardLabels(labels: readonly CardLabel[]): CardLabel[] {
  return CARD_LABELS.filter((label) => labels.includes(label))
}

/** The keep-exclusivity refusal, or `undefined` for a legal combination. */
function exclusivityError(labels: readonly CardLabel[]): string | undefined {
  if (labels.includes('keep') && labels.length > 1) {
    return "'keep' cannot be combined with 'sale' or 'trade'."
  }
  return undefined
}

/**
 * Parse a comma-separated label token body (`sale,trade`) as it appears in a
 * card line's bracketed token or a CLI `--label` value. Case-insensitive like
 * every enum surface; the result is normalized. An empty body and an illegal
 * `keep` combination are refusals.
 */
export function parseCardLabelsToken(raw: string): CardLabelsResult {
  const parts = raw.split(',').map((part) => part.trim())
  if (parts.some((part) => part === '')) {
    return {
      ok: false,
      message: `Labels must be a comma-separated list of: ${CARD_LABELS.join(', ')}.`,
    }
  }
  const labels: CardLabel[] = []
  for (const part of parts) {
    const parsed = parseEnumField(part, CARD_LABELS, 'label')
    if (!parsed.ok) return parsed
    labels.push(parsed.value)
  }
  const conflict = exclusivityError(labels)
  if (conflict) return { ok: false, message: conflict }
  return { ok: true, labels: normalizeCardLabels(labels) }
}

/** `Array.isArray` narrowed to `unknown[]` rather than `any[]` — a parse boundary stays opaque. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/**
 * Parse a label set from structured data — a front-matter `labels:` value or an
 * HTTP body field. Must be an array of label strings (case-insensitive); the
 * result is normalized. An empty array is `ok` with `[]` — callers decide what
 * empty means (front matter treats it as "no default", the metadata route as
 * "clear").
 */
export function parseCardLabelsValue(raw: unknown, field: string): CardLabelsResult {
  if (!isUnknownArray(raw)) {
    return {
      ok: false,
      message: `${field} must be an array of labels (${CARD_LABELS.join(', ')}).`,
    }
  }
  const labels: CardLabel[] = []
  for (const element of raw) {
    const parsed = parseEnumField(element, CARD_LABELS, field)
    if (!parsed.ok) return parsed
    labels.push(parsed.value)
  }
  const conflict = exclusivityError(labels)
  if (conflict) return { ok: false, message: conflict }
  return { ok: true, labels: normalizeCardLabels(labels) }
}

/**
 * The canonical comma-joined form (`sale,trade`) written to card-line tokens
 * and changelog lines. Input is assumed already validated; ordering is
 * re-normalized so no caller can serialize `trade,sale`.
 */
export function formatCardLabels(labels: readonly CardLabel[]): string {
  return normalizeCardLabels(labels).join(',')
}

/**
 * Whether two label sets are the same override: order-insensitive, with an
 * absent set equal to an empty one. Compared through the canonical serialized
 * form, so `['trade','sale']` equals `['sale','trade']` — the rule behind
 * every "did the label actually change?" check.
 */
export function sameCardLabels(
  a: readonly CardLabel[] | undefined,
  b: readonly CardLabel[] | undefined,
): boolean {
  return formatCardLabels(a ?? []) === formatCardLabels(b ?? [])
}

/**
 * The labels a card is effectively under: its own override when present, else
 * the list's default, else none. A present override replaces the default
 * entirely — file data never carries an *empty* override (the token grammar
 * requires at least one label), so `undefined` always means "no override".
 */
export function effectiveLabels(
  override: readonly CardLabel[] | undefined,
  listDefault: readonly CardLabel[] | undefined,
): CardLabel[] {
  return [...(override ?? listDefault ?? [])]
}

/** One pickable override in the label pickers, in menu order. */
export type CardLabelChoice = { label: string; labels: readonly CardLabel[] }

/**
 * The five override states every label picker offers (the CLI edit menu, the
 * editors' Set Label… picker, and — minus the clear row — the admin default-
 * labels modal). `keep` doubles as the explicit "not for sale/trade" state, so
 * there is no separate "none" label; "Use list default" clears the override
 * (an empty label set).
 */
export const CARD_LABEL_CHOICES = [
  { label: CARD_LABEL_DISPLAY_NAMES.sale, labels: ['sale'] },
  { label: CARD_LABEL_DISPLAY_NAMES.trade, labels: ['trade'] },
  { label: 'For sale + trade', labels: ['sale', 'trade'] },
  { label: CARD_LABEL_DISPLAY_NAMES.keep, labels: ['keep'] },
  { label: 'Use list default', labels: [] },
] as const satisfies readonly CardLabelChoice[]
