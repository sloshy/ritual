/**
 * Card labels: the owner's declared intent for a card — `sale` ("For sale") and
 * `trade` ("For trade"), which combine, or `keep` ("To keep") and `proxy`
 * ("Proxy"), which each stand alone. A list declares a default in its front
 * matter (`labels: [sale, trade]`), and an individual card line may override it
 * with a bracketed token (`[keep]`, `[sale,trade]`); the override *replaces*
 * the default, it never merges with it.
 *
 * Which labels a list may carry depends on its type — see
 * {@link LIST_TYPE_LABELS}: collections take the whole vocabulary, decks take
 * `proxy` alone, and wanted-list entries never carry labels at all.
 *
 * Layer-neutral on purpose (like {@link module:parse-enum}): the same
 * vocabulary, canonical ordering, and exclusivity rule are asked for by the
 * file parsers, the CLI flags, the HTTP bodies, and the site UI, and must
 * answer identically in each.
 */

import type { MessageKey } from './i18n/messages/en'
import { t } from './i18n/t'
import type { ListType } from './list-type'
import { parseEnumField } from './parse-enum'

/** Every label, in canonical serialization order (`sale` before `trade`). */
export const CARD_LABELS = ['sale', 'trade', 'keep', 'proxy'] as const

/**
 * The alternation a card line's bracketed labels token matches, built from the
 * vocabulary so no grammar can drift from it. Every list type's line regex
 * accepts the *whole* vocabulary — a label its type does not support is a parse
 * warning naming the offender, not an unreadable line (see
 * {@link LIST_TYPE_LABELS}).
 */
export const LABEL_TOKEN_PATTERN = `(?:${CARD_LABELS.join('|')})`

/**
 * A single card label. `sale` and `trade` combine; `keep` and `proxy` each
 * stand alone. Derived from {@link CARD_LABELS} so the runtime list and the
 * type can never drift — every schema, regex assertion, and canonical ordering
 * hangs off it.
 */
export type CardLabel = (typeof CARD_LABELS)[number]

/**
 * The labels that cannot be combined with any other — including each other.
 * `keep` declares "not going anywhere" and `proxy` declares "not a real card",
 * and neither statement survives being paired with an offer to sell or trade.
 */
export const EXCLUSIVE_CARD_LABELS = ['keep', 'proxy'] as const satisfies readonly CardLabel[]

/** Which labels each list type may carry. See {@link LIST_TYPE_LABELS}. */
export type ListTypeLabelSupport = Record<ListType, readonly CardLabel[]>

/**
 * The label vocabulary each list type accepts, and the single answer behind
 * every "labels apply here?" guard — the file parsers, the CLI flags, the HTTP
 * bodies, and the pickers. Decks carry `proxy` only: a deck lists what you
 * intend to play, so "for sale" says nothing there, while "this copy is a
 * proxy" says a great deal.
 */
export const LIST_TYPE_LABELS = {
  deck: ['proxy'],
  collection: CARD_LABELS,
  wanted: [],
} as const satisfies ListTypeLabelSupport

/** The labels `type` accepts, widened to the vocabulary for membership tests. */
function supportedLabels(type: ListType): readonly CardLabel[] {
  return LIST_TYPE_LABELS[type]
}

/** True when `type` carries labels at all (wanted lists do not). */
export function supportsAnyLabels(type: ListType): boolean {
  return supportedLabels(type).length > 0
}

/**
 * The members of `labels` that `type` does not accept, in canonical order —
 * empty when every label is legal there. Callers name them in the refusal, so
 * the user is told which label was the problem rather than that "labels" were.
 */
export function unsupportedLabelsFor(type: ListType, labels: readonly CardLabel[]): CardLabel[] {
  const supported = supportedLabels(type)
  return normalizeCardLabels(labels).filter((label) => !supported.includes(label))
}

/**
 * The part of `labels` that `type` can express, in canonical order — the mirror
 * of {@link unsupportedLabelsFor}, for the paths that *keep* what fits (a move
 * into a deck) rather than refusing the whole set.
 */
export function supportedLabelsFor(type: ListType, labels: readonly CardLabel[]): CardLabel[] {
  const supported = supportedLabels(type)
  return normalizeCardLabels(labels).filter((label) => supported.includes(label))
}

/**
 * Whether a label set may be written to a list of `type`, and which labels are
 * the problem when it may not.
 *
 * The one answer behind every "labels apply here?" guard — the CLI flags, the
 * one-shot apply path, the admin save bodies, the change-bundle importer, and
 * the MCP tool schemas. They had drifted into five near-copies that disagreed
 * about the empty set, which is the whole reason this lives here.
 */
export type LabelSupportResult = { ok: true } | { ok: false; unsupported: CardLabel[] }

/**
 * Check `labels` against what `type` carries.
 *
 * An empty set is a *clear* ("use the list default"), so it passes on any type
 * that carries labels at all — but it still says nothing on a wanted list, and
 * is refused there with no offenders to name. A non-empty set is refused when
 * any member is outside the type's vocabulary, and the refusal names exactly
 * those members.
 */
export function checkLabelsForListType(
  type: ListType,
  labels: readonly CardLabel[],
): LabelSupportResult {
  const unsupported = unsupportedLabelsFor(type, labels)
  if (unsupported.length > 0) return { ok: false, unsupported }
  if (!supportsAnyLabels(type)) return { ok: false, unsupported: [] }
  return { ok: true }
}

/**
 * The refusal prose for a {@link checkLabelsForListType} failure, shared by the
 * English API and data surfaces (HTTP 400 bodies, change-bundle validation, MCP
 * schema issues) so they refuse in identical words. The CLI has its own
 * localized key for the same decision — machine-facing surfaces do not
 * localize, per the message-catalog rules.
 */
export function unsupportedLabelsMessage(
  type: ListType,
  unsupported: readonly CardLabel[],
): string {
  const supported = supportedLabels(type)
  if (supported.length === 0) return `labels do not apply to a ${type}.`
  return (
    `labels [${unsupported.join(', ')}] are not supported on a ${type}; ` +
    `supported: ${supported.join(', ')}.`
  )
}

/**
 * True when a card's *effective* labels mark it a proxy — a card that is not
 * real, and therefore prices at nothing, sells to nobody, and counts toward no
 * shortfall. The single predicate behind that rule everywhere: the price and
 * sell reports, the baked site details, the buylist quotes, and every client
 * recompute. Pass effective labels (override already resolved against the list
 * default), which is what {@link effectiveLabels} produces.
 */
export function isProxy(labels: readonly CardLabel[] | undefined): boolean {
  return labels?.includes('proxy') === true
}

/**
 * Every reason a copy carries no price *by rule*, in the order the surfaces
 * list them. The price engine re-exports this array as its by-rule unpriced
 * reasons and the site's marker table keys off it, so a reason added here is a
 * compile error everywhere it has to be handled rather than a silent omission.
 */
export const PRICELESS_REASONS = ['proxy', 'custom-art'] as const

/**
 * Why a copy carries no price *by rule* — a statement about the card in hand
 * rather than about the price data. A proxy is not a real card; a card wearing
 * custom art is no longer the printing a price or a quote would be for.
 */
export type PricelessReason = (typeof PRICELESS_REASONS)[number]

/**
 * The single rule behind "no price, no quote, no sale", shared by every surface:
 * the price and sell engines, the site bakers, the buylist quotes, the trade
 * board, and every client recompute. Returns `undefined` for a copy that prices
 * normally.
 *
 * Custom art wins over the proxy label when both apply — a card wearing art of
 * its own is the more specific thing to say about it — so a surface rendering
 * the reason as a marker never has to decide the precedence itself.
 *
 * `labels` are the card's *effective* labels ({@link effectiveLabels}), and
 * `hasCustomArt` is whether the list's art sidecar gives this card an image;
 * the reference itself is never needed to answer this.
 */
export function pricelessReason(
  labels: readonly CardLabel[] | undefined,
  hasCustomArt: boolean,
): PricelessReason | undefined {
  if (hasCustomArt) return 'custom-art'
  if (isProxy(labels)) return 'proxy'
  return undefined
}

/** Whether a copy is priceless by rule (see {@link pricelessReason}). */
export function isPriceless(
  labels: readonly CardLabel[] | undefined,
  hasCustomArt: boolean,
): boolean {
  return pricelessReason(labels, hasCustomArt) !== undefined
}

/**
 * Every message key naming a label state. Narrower than `MessageKey` so `t()`
 * can be called on a value of this type without params — `Extract` also makes a
 * key that no longer exists in the catalog resolve to `never`, and therefore a
 * compile error at the tables below.
 */
export type CardLabelMessageKey = Extract<MessageKey, `domain.label.${string}`>

/**
 * Message keys for each label's human wording, used by every display surface.
 * Keys rather than rendered text: the table is evaluated once at module load,
 * so strings here would leave every chip and menu row in the boot-time
 * language after a locale switch. Resolve with {@link cardLabelName}.
 */
export const CARD_LABEL_DISPLAY_NAMES = {
  sale: 'domain.label.sale',
  trade: 'domain.label.trade',
  keep: 'domain.label.keep',
  proxy: 'domain.label.proxy',
} as const satisfies Record<CardLabel, MessageKey>

/** A label's human wording in the active UI locale ("For sale"). */
export function cardLabelName(label: CardLabel): string {
  return t(CARD_LABEL_DISPLAY_NAMES[label])
}

/** True when `value` is a member of the label vocabulary. */
export function isCardLabel(value: string): value is CardLabel {
  return (CARD_LABELS as readonly string[]).includes(value)
}

/**
 * One selectable value when *filtering* by label: a card label, or `'none'`
 * for cards whose effective label set is empty. A selection selects, it does
 * not declare — so unlike the label vocabulary itself, a selection may combine
 * an exclusive label with the others (the export filter allows it; the site's
 * chips additionally choose to keep `keep`/`proxy`/`none` exclusive for UI
 * symmetry with the declaration rules).
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
 * The label-filter chips a list of `type` offers: every label that type may
 * carry, in canonical order, plus the "unlabeled" chip. Empty for a type that
 * carries no labels at all, which is what hides the chip row entirely.
 *
 * A pure derivation of {@link LIST_TYPE_LABELS}, so a page cannot hand-maintain
 * a chip list that outlives a vocabulary change — and the same value answers
 * both "which chips do we draw?" and "which `labels=` URL values do we honor?".
 */
export function labelFiltersFor(type: ListType): readonly CardLabelSelection[] {
  const supported = supportedLabels(type)
  if (supported.length === 0) return []
  return CARD_LABEL_SELECTIONS.filter(
    (value) => value === CARD_LABEL_SELECTION_NONE || supported.includes(value),
  )
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

/**
 * A card's stored label override, normalized: the canonical set, or `undefined`
 * when there is nothing to store. An *empty* set is a clear, and file data never
 * carries an empty override — the token grammar needs at least one label — so
 * "no labels" and "no override" must be the same value in memory. Every apply
 * engine writes an override through this, so none of them can invent an `[]`
 * the serializers cannot express.
 */
export function normalizedOverride(
  labels: readonly CardLabel[] | undefined,
): CardLabel[] | undefined {
  if (labels === undefined || labels.length === 0) return undefined
  return normalizeCardLabels(labels)
}

/** The exclusivity refusal, or `undefined` for a legal combination. */
function exclusivityError(labels: readonly CardLabel[]): string | undefined {
  if (labels.length < 2) return undefined
  const exclusive = EXCLUSIVE_CARD_LABELS.find((label) => labels.includes(label))
  return exclusive === undefined ? undefined : t('errors.label.exclusive', { label: exclusive })
}

/**
 * Parse a comma-separated label token body (`sale,trade`) as it appears in a
 * card line's bracketed token or a CLI `--label` value. Case-insensitive like
 * every enum surface; the result is normalized. An empty body and a
 * combination naming an exclusive label are refusals.
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
 * What a list's front-matter `labels:` default parsed to: the declared default,
 * or the warning explaining why the value was ignored. Both absent means the
 * list simply declares no default.
 */
export type ListDefaultLabelsResult = {
  /** The declared default, when it is a legal non-empty set for the list type. */
  labels?: CardLabel[]
  /**
   * Why the value was ignored. A warning rather than an advisory on the deck
   * path, deliberately: the value is dropped from the file on the next save
   * (`validateDeckFrontMatter` deletes the key), exactly like a card line's
   * refused `[keep]` token — so the whole-file-rewrite gates must see it.
   */
  warning?: string
}

/**
 * Read a list's front-matter `labels:` value as its default card labels.
 *
 * Call it only when the key is present: an absent key declares nothing, while a
 * present-but-unreadable one is worth a word. An empty array reads as "no
 * default" (no warning — writing `labels: []` is a legitimate way to say it).
 * Shared by the deck front-matter validator and the deck parser so a file's
 * default is judged identically on the read and write sides.
 */
export function readListDefaultLabels(type: ListType, raw: unknown): ListDefaultLabelsResult {
  const parsed = parseCardLabelsValue(raw, 'labels')
  if (!parsed.ok) {
    return {
      warning:
        `Front matter 'labels' ignored: ${parsed.message} ` + 'A rewrite would drop the key.',
    }
  }
  if (parsed.labels.length === 0) return {}
  const unsupported = unsupportedLabelsFor(type, parsed.labels)
  if (unsupported.length > 0) {
    return {
      warning:
        `Front matter 'labels' ignored: ${unsupportedLabelsMessage(type, unsupported)} ` +
        'A rewrite would drop the key.',
    }
  }
  return { labels: parsed.labels }
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

/**
 * One pickable override in the label pickers, in menu order. `label` is a
 * message key for the same reason {@link CARD_LABEL_DISPLAY_NAMES} holds keys —
 * the choice lists below are module-level constants.
 */
export type CardLabelChoice = { label: CardLabelMessageKey; labels: readonly CardLabel[] }

/**
 * Every override state a label picker can offer (the CLI edit menu, the
 * editors' Set Label… picker, and — minus the clear row — the admin default-
 * labels modal). `keep` doubles as the explicit "not for sale/trade" state, so
 * there is no separate "none" label; "Use list default" clears the override
 * (an empty label set).
 *
 * Per-list-type pickers are *derived* from this one table by
 * {@link cardLabelChoicesFor}: a second hardcoded table for decks would drift
 * from {@link LIST_TYPE_LABELS} the first time the vocabulary changed.
 */
const ALL_CARD_LABEL_CHOICES = [
  { label: CARD_LABEL_DISPLAY_NAMES.sale, labels: ['sale'] },
  { label: CARD_LABEL_DISPLAY_NAMES.trade, labels: ['trade'] },
  { label: 'domain.label.saleAndTrade', labels: ['sale', 'trade'] },
  { label: CARD_LABEL_DISPLAY_NAMES.keep, labels: ['keep'] },
  { label: CARD_LABEL_DISPLAY_NAMES.proxy, labels: ['proxy'] },
  { label: 'domain.label.useListDefault', labels: [] },
] as const satisfies readonly CardLabelChoice[]

/**
 * The override rows a picker on a list of `type` offers: every state whose
 * labels that type accepts, plus the "Use list default" clear row (which
 * declares nothing, so it survives every type).
 */
export function cardLabelChoicesFor(type: ListType): readonly CardLabelChoice[] {
  const supported = supportedLabels(type)
  return ALL_CARD_LABEL_CHOICES.filter((choice) =>
    choice.labels.every((label) => supported.includes(label)),
  )
}

/**
 * The *default*-labels picker rows for a list of `type` (the admin Default
 * Labels modal and the CLI editor's Edit List Labels action): each labeled
 * state that type accepts plus a leading "No default" clear row — "Use list
 * default" makes no sense for the default itself.
 */
export function cardLabelDefaultChoicesFor(type: ListType): readonly CardLabelChoice[] {
  return [
    { label: 'domain.label.noDefault', labels: [] },
    ...cardLabelChoicesFor(type).filter((choice) => choice.labels.length > 0),
  ]
}

/** The override picker rows for collections — the whole vocabulary. */
export const CARD_LABEL_CHOICES: readonly CardLabelChoice[] = cardLabelChoicesFor('collection')

/** The default-labels picker rows for collections. */
export const CARD_LABEL_DEFAULT_CHOICES: readonly CardLabelChoice[] =
  cardLabelDefaultChoicesFor('collection')
