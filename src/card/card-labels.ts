/**
 * Card labels: the owner's declared intent for a card — `sale` ("For sale") and
 * `trade` ("For trade"), which combine, or `keep` ("To keep") and `proxy`
 * ("Proxy"), which each stand alone. A list declares a default in its front
 * matter (`labels: [sale, trade]`), and an individual card line may *adjust* it
 * with a bracketed token of signed labels: a positive adds a label
 * (`[trade]`), a `no-` negative takes an inherited one away (`[no-sale]`), and
 * both combine (`[trade,no-sale]`). See {@link effectiveLabels} for the one
 * rule that resolves a line against its list.
 *
 * Which labels a list may carry depends on its type — see
 * {@link LIST_TYPE_LABELS}: collections take the whole vocabulary, decks take
 * `proxy` alone (so `[no-proxy]` too), and wanted-list entries never carry
 * labels at all. Defaults are positive only; negatives live on card lines.
 *
 * Layer-neutral on purpose (like {@link module:parse-enum}): the same
 * vocabulary, canonical ordering, and exclusivity rule are asked for by the
 * file parsers, the CLI flags, the HTTP bodies, and the site UI, and must
 * answer identically in each.
 */

import { formatUnitList } from '../i18n/format'
import type { MessageKey } from '../i18n/messages/en'
import { t, tIn } from '../i18n/t'
import type { LocaleTag } from '../i18n/types'
import type { ListType } from '../list/list-type'
import {
  nestSync,
  syncList,
  syncMessage,
  syncRef,
  type SyncListParam,
  type SyncMessage,
} from '../sync/message'
import { isUnknownArray } from '../util/guards'
import { parseEnumField } from '../util/parse-enum'

/** Every label, in canonical serialization order (`sale` before `trade`). */
export const CARD_LABELS = ['sale', 'trade', 'keep', 'proxy'] as const

/**
 * A single card label. `sale` and `trade` combine; `keep` and `proxy` each
 * stand alone. Derived from {@link CARD_LABELS} so the runtime list and the
 * type can never drift — every schema, regex assertion, and canonical ordering
 * hangs off it.
 */
export type CardLabel = (typeof CARD_LABELS)[number]

/** The prefix that negates a label on a card line (`no-proxy`). */
export const NEGATED_LABEL_PREFIX = 'no-'

/** A negated label: "this copy is *not* …", taking an inherited label away. */
export type NegatedCardLabel = `no-${CardLabel}`

/** One member of a card line's label token: a label, or its negation. */
export type SignedCardLabel = CardLabel | NegatedCardLabel

/**
 * Every signed label, in canonical serialization order: the positives, then
 * the negatives, each half in {@link CARD_LABELS} order.
 */
export const SIGNED_CARD_LABELS = [
  'sale',
  'trade',
  'keep',
  'proxy',
  'no-sale',
  'no-trade',
  'no-keep',
  'no-proxy',
] as const satisfies readonly SignedCardLabel[]

/**
 * Compile-time completeness check: a signed label missing from
 * {@link SIGNED_CARD_LABELS} makes this `never`, so the assignment fails.
 */
const SIGNED_CARD_LABELS_COMPLETE: Exclude<
  SignedCardLabel,
  (typeof SIGNED_CARD_LABELS)[number]
> extends never
  ? true
  : never = true
void SIGNED_CARD_LABELS_COMPLETE

/**
 * A card line's label override: how it adjusts its list's default. Canonical
 * when produced by {@link normalizedOverride} (positives first, then negatives,
 * void negatives dropped) and never empty when stored — an empty override is no
 * override, which is what `undefined` means.
 */
export type LabelOverride = SignedCardLabel[]

/** A {@link LabelOverride} split into the labels it adds and the ones it takes away. */
export type LabelDelta = { add: CardLabel[]; remove: CardLabel[] }

/**
 * The alternation one member of a card line's bracketed labels token matches,
 * built from the vocabulary so no grammar can drift from it. Every list type's
 * line regex accepts the *whole* signed vocabulary — a label its type does not
 * support is a parse warning naming the offender, not an unreadable line (see
 * {@link LIST_TYPE_LABELS}).
 */
export const LABEL_TOKEN_PATTERN = `(?:${NEGATED_LABEL_PREFIX})?(?:${CARD_LABELS.join('|')})`

/**
 * The labels that cannot be combined with any other — including each other.
 * `keep` declares "not going anywhere" and `proxy` declares "not a real card",
 * and neither statement survives being paired with an offer to sell or trade.
 */
export const EXCLUSIVE_CARD_LABELS = ['keep', 'proxy'] as const satisfies readonly CardLabel[]

/** True when `label` is one of the {@link EXCLUSIVE_CARD_LABELS}. */
function isExclusiveLabel(label: CardLabel): boolean {
  return (EXCLUSIVE_CARD_LABELS as readonly CardLabel[]).includes(label)
}

/** Which labels each list type may carry. See {@link LIST_TYPE_LABELS}. */
export type ListTypeLabelSupport = Record<ListType, readonly CardLabel[]>

/**
 * The label vocabulary each list type accepts, and the single answer behind
 * every "labels apply here?" guard — the file parsers, the CLI flags, the HTTP
 * bodies, and the pickers. Decks carry `proxy` only: a deck lists what you
 * intend to play, so "for sale" says nothing there, while "this copy is a
 * proxy" says a great deal. A negation is legal wherever its label is.
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

/** True when `value` is a member of the label vocabulary. */
export function isCardLabel(value: string): value is CardLabel {
  return (CARD_LABELS as readonly string[]).includes(value)
}

/** True when `value` is a member of the signed vocabulary (`sale`, `no-sale`, …). */
export function isSignedCardLabel(value: string): value is SignedCardLabel {
  return (SIGNED_CARD_LABELS as readonly string[]).includes(value)
}

/** The negation of `label` (`proxy` → `no-proxy`). */
export function negateLabel(label: CardLabel): NegatedCardLabel {
  return `${NEGATED_LABEL_PREFIX}${label}`
}

/** True when a signed label is a negation. */
export function isNegatedLabel(label: SignedCardLabel): label is NegatedCardLabel {
  return label.startsWith(NEGATED_LABEL_PREFIX)
}

/** Each negation's label, spelled out so the lookup is exhaustive and cast-free. */
const NEGATION_BASE = {
  'no-sale': 'sale',
  'no-trade': 'trade',
  'no-keep': 'keep',
  'no-proxy': 'proxy',
} as const satisfies Record<NegatedCardLabel, CardLabel>

/** The label a signed label is about (`no-proxy` → `proxy`). */
export function baseLabel(label: SignedCardLabel): CardLabel {
  return isNegatedLabel(label) ? NEGATION_BASE[label] : label
}

/**
 * The members of `labels` that `type` does not accept, in canonical order —
 * empty when every label is legal there. A negation is judged by its label, and
 * named as written (`no-sale` on a deck), so the user is told which token was
 * the problem rather than that "labels" were.
 */
export function unsupportedLabelsFor(
  type: ListType,
  labels: readonly SignedCardLabel[],
): SignedCardLabel[] {
  const supported = supportedLabels(type)
  return SIGNED_CARD_LABELS.filter(
    (label) => labels.includes(label) && !supported.includes(baseLabel(label)),
  )
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
export type LabelSupportResult = { ok: true } | { ok: false; unsupported: SignedCardLabel[] }

/**
 * Check `labels` (an override or a default) against what `type` carries.
 *
 * An empty set is a *clear* ("use the list default"), so it passes on any type
 * that carries labels at all — but it still says nothing on a wanted list, and
 * is refused there with no offenders to name. A non-empty set is refused when
 * any member is outside the type's vocabulary, and the refusal names exactly
 * those members.
 */
export function checkLabelsForListType(
  type: ListType,
  labels: readonly SignedCardLabel[],
): LabelSupportResult {
  const unsupported = unsupportedLabelsFor(type, labels)
  if (unsupported.length > 0) return { ok: false, unsupported }
  if (!supportsAnyLabels(type)) return { ok: false, unsupported: [] }
  return { ok: true }
}

/**
 * The refusal for a {@link checkLabelsForListType} failure, shared by the API
 * and data surfaces (HTTP 400 bodies, change-bundle validation, the apply-path
 * guard, MCP schema issues) so they refuse in identical words: English plus its
 * key, which each surface sends as it is or renders in its reader's language.
 * The CLI has its own localized key for the same decision.
 */
export function unsupportedLabelsMessage(
  type: ListType,
  unsupported: readonly SignedCardLabel[],
): SyncMessage {
  const supported = supportedLabels(type)
  if (supported.length === 0)
    return syncMessage('domain.card.label.notApplicable', { listType: type })
  return syncMessage('domain.card.label.unsupported', {
    listType: type,
    // Label tokens, joined the way the file and the flags spell a set.
    labels: unsupported.join(', '),
    supported: supported.join(', '),
  })
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

/** Message keys for each negation's wording ("Not for sale"), like {@link CARD_LABEL_DISPLAY_NAMES}. */
export const NEGATED_CARD_LABEL_DISPLAY_NAMES = {
  sale: 'domain.label.notSale',
  trade: 'domain.label.notTrade',
  keep: 'domain.label.notKeep',
  proxy: 'domain.label.notProxy',
} as const satisfies Record<CardLabel, MessageKey>

/** A label's human wording in the active UI locale ("For sale"). */
export function cardLabelName(label: CardLabel): string {
  return t(CARD_LABEL_DISPLAY_NAMES[label])
}

/** A signed label's human wording in the active UI locale ("For sale", "Not a proxy"). */
export function signedLabelName(label: SignedCardLabel): string {
  return t(signedLabelKey(label))
}

/**
 * Message keys for each label's compact tile badge ("sale"), the short form of
 * {@link CARD_LABEL_DISPLAY_NAMES} for a tile whose name line truncates.
 * Resolve with {@link cardLabelBadge}.
 */
export const CARD_LABEL_BADGES = {
  sale: 'domain.label.badge.sale',
  trade: 'domain.label.badge.trade',
  keep: 'domain.label.badge.keep',
  proxy: 'domain.label.badge.proxy',
} as const satisfies Record<CardLabel, MessageKey>

/** A label's compact badge text in the active UI locale ("sale"). */
export function cardLabelBadge(label: CardLabel): string {
  return t(CARD_LABEL_BADGES[label])
}

/** The message key naming a signed label ("For sale", "Not a proxy"). */
function signedLabelKey(label: SignedCardLabel): CardLabelMessageKey {
  return isNegatedLabel(label)
    ? NEGATED_CARD_LABEL_DISPLAY_NAMES[baseLabel(label)]
    : CARD_LABEL_DISPLAY_NAMES[label]
}

/**
 * A positive label set for a reader — "For sale, For trade" — in canonical
 * order, named and joined the way `locale` lists independent items. The display
 * twin of {@link formatCardLabels}, whose `sale,trade` is the file form. The
 * locale is a required argument, as on `languageLabel`: this module sits on the
 * changelog writer's import route, and a hidden read of the active locale is
 * what must never reach a persisted line.
 */
export function cardLabelsDisplay(labels: readonly CardLabel[], locale: LocaleTag): string {
  return formatUnitList(
    locale,
    normalizeCardLabels(labels).map((label) => tIn(locale, CARD_LABEL_DISPLAY_NAMES[label])),
  )
}

/**
 * A label override for a reader — "For trade, Not for sale" — in canonical
 * order, in `locale`. The display twin of {@link formatLabelOverride}.
 */
export function signedLabelsDisplay(labels: readonly SignedCardLabel[], locale: LocaleTag): string {
  return formatUnitList(
    locale,
    normalizeLabelOverride(labels).map((label) => tIn(locale, signedLabelKey(label))),
  )
}

/**
 * {@link signedLabelsDisplay} unrendered, for a message param rendered later in
 * its reader's locale (a `--output json` payload's nested params).
 */
export function signedLabelsParam(labels: readonly SignedCardLabel[]): SyncListParam {
  return syncList(
    normalizeLabelOverride(labels).map((label) => syncRef(signedLabelKey(label))),
    'unit',
  )
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
 * The outcome of parsing a positive label set (a list default): the normalized
 * labels, or why the input was refused — a message (English plus its key) the
 * caller sends on as it is or renders in its reader's language.
 */
export type CardLabelsResult = { ok: true; labels: CardLabel[] } | { ok: false; error: SyncMessage }

/**
 * The outcome of parsing a card line's override from data: the normalized
 * override, or why it was refused, as a message like {@link CardLabelsResult}'s.
 */
export type LabelOverrideResult =
  { ok: true; labels: LabelOverride } | { ok: false; error: SyncMessage }

/**
 * The outcome of parsing a CLI `--label` value: the normalized override, or the
 * refusal already worded in the CLI's language.
 */
export type LabelOverrideTokenResult =
  { ok: true; labels: LabelOverride } | { ok: false; message: string }

/**
 * Dedupe and order a label set canonically (`sale,trade`, never `trade,sale`).
 * Pure normalization — exclusivity is the parsers' job, so an already-validated
 * set can be re-normalized without re-deciding whether it was legal.
 */
export function normalizeCardLabels(labels: readonly CardLabel[]): CardLabel[] {
  return CARD_LABELS.filter((label) => labels.includes(label))
}

/**
 * A positive label set (effective labels, a default) normalized for storage:
 * the canonical set, or `undefined` when it is empty — the shape an export
 * entry or a payload carries, where "no labels" is an absent field.
 */
export function normalizedLabelSet(
  labels: readonly CardLabel[] | undefined,
): CardLabel[] | undefined {
  if (labels === undefined || labels.length === 0) return undefined
  return normalizeCardLabels(labels)
}

/**
 * Whether an inherited `label` gives way to a line's positive `add` labels
 * under the exclusivity rule: a line that adds any label displaces an inherited
 * exclusive one, and a line that adds an exclusive label displaces everything
 * it did not add itself. With nothing added, nothing is displaced.
 */
function displacedBy(add: readonly CardLabel[], label: CardLabel): boolean {
  if (add.length === 0 || add.includes(label)) return false
  return isExclusiveLabel(label) || add.some(isExclusiveLabel)
}

/** Split a (validated) override into what it adds and what it takes away, each canonical. */
export function labelDelta(override: readonly SignedCardLabel[]): LabelDelta {
  return {
    add: CARD_LABELS.filter((label) => override.includes(label)),
    remove: CARD_LABELS.filter((label) => override.includes(negateLabel(label))),
  }
}

/** The labels an override names at all, positively or negated, in canonical order. */
export function overrideBaseLabels(override: readonly SignedCardLabel[]): CardLabel[] {
  return CARD_LABELS.filter(
    (label) => override.includes(label) || override.includes(negateLabel(label)),
  )
}

/**
 * Order a (validated) override canonically and drop its **void** negatives —
 * negations of labels the line's own positives already displace under any
 * default (`[keep,no-sale]` is `[keep]`), so two lines that mean the same thing
 * under every default serialize the same. Validity (no exclusive conflict, no
 * label both added and taken away) is the parsers' job.
 */
export function normalizeLabelOverride(override: readonly SignedCardLabel[]): LabelOverride {
  const { add, remove } = labelDelta(override)
  return [...add, ...remove.filter((label) => !displacedBy(add, label)).map(negateLabel)]
}

/**
 * A card's stored label override, normalized ({@link normalizeLabelOverride}),
 * or `undefined` when there is nothing to store. An *empty* set is a clear, and
 * file data never carries an empty override — the token grammar needs at least
 * one label — so "no override" and an empty one must be the same value in
 * memory. Every apply engine writes an override through this, so none of them
 * can invent an `[]` the serializers cannot express.
 */
export function normalizedOverride(
  labels: readonly SignedCardLabel[] | undefined,
): LabelOverride | undefined {
  if (labels === undefined) return undefined
  const normalized = normalizeLabelOverride(labels)
  return normalized.length === 0 ? undefined : normalized
}

/**
 * The labels a card is effectively under: its list's default adjusted by its
 * own override. The override's positives are added; its negatives take
 * inherited labels away; and an added label displaces any *inherited* label it
 * cannot stand beside under the exclusivity rule — so `[keep]` under a `sale`
 * default is just `keep`, `[trade]` under a `sale` default is `sale,trade`, and
 * `[no-proxy]` under a `proxy` default is no labels at all.
 *
 * The one rule behind every effective-labels question: pricing and proxies,
 * sell mode, filters, exports, merge identity, and every client recompute.
 */
export function effectiveLabels(
  override: readonly SignedCardLabel[] | undefined,
  listDefault: readonly CardLabel[] | undefined,
): CardLabel[] {
  const { add, remove } = labelDelta(override ?? [])
  const inherited = (listDefault ?? []).filter(
    (label) => !remove.includes(label) && !displacedBy(add, label),
  )
  return normalizeCardLabels([...add, ...inherited])
}

/**
 * The smallest override that makes a card's effective labels exactly `target`
 * under `listDefault`, or `undefined` when the default already gives them. What
 * every picker writes, and how a moved copy lands: neither ever writes a token
 * the line does not need. `target` must be a legal label set.
 */
export function minimalOverride(
  target: readonly CardLabel[],
  listDefault: readonly CardLabel[] | undefined,
): LabelOverride | undefined {
  const inheritedDefault = listDefault ?? []
  if (sameCardLabels(target, inheritedDefault)) return undefined
  const add = target.filter((label) => !inheritedDefault.includes(label))
  const remove = inheritedDefault.filter(
    (label) => !displacedBy(add, label) && !target.includes(label),
  )
  return normalizedOverride([...add, ...remove.map(negateLabel)])
}

/**
 * The labels a copy carries across a move: its labels **as its source states
 * them**, signed. The positives are its effective labels there; a negative
 * names a label its source had an opinion on — the list default holds it, or
 * the line names it — that the copy does not have. A label the source never
 * mentioned is absent, which is what lets the destination's default fill it in
 * on arrival ({@link arrivalLabels}).
 */
export function carriedLabels(
  override: readonly SignedCardLabel[] | undefined,
  listDefault: readonly CardLabel[] | undefined,
): LabelOverride | undefined {
  const effective = effectiveLabels(override, listDefault)
  const mentioned = normalizeCardLabels([
    ...(listDefault ?? []),
    ...overrideBaseLabels(override ?? []),
  ])
  const lacking = mentioned.filter((label) => !effective.includes(label))
  return normalizedOverride([...effective, ...lacking.map(negateLabel)])
}

/**
 * A moved copy's effective labels in its source, read off its carried labels
 * ({@link carriedLabels}): their positives.
 */
export function carriedEffectiveLabels(
  carried: readonly SignedCardLabel[] | undefined,
): CardLabel[] {
  return labelDelta(carried ?? []).add
}

/**
 * The override a moved copy is written with on arrival in a list of
 * `destType` whose default is `destDefault`, given the labels it carries
 * ({@link carriedLabels}) and the type of the list it left.
 *
 * - `proxy` is a physical fact, preserved exactly wherever both types carry
 *   it: a real card stays real (`[no-proxy]` under a `proxy` default) and a
 *   proxy stays a proxy.
 * - An intent label (`sale`, `trade`, `keep`) keeps the state its source gave
 *   it where the source had an opinion (the carried labels name it, either
 *   way); where it had none — a source type that cannot carry it included — the
 *   copy takes the destination's default.
 * - The destination's vocabulary filters the result (`proxy` into a deck,
 *   nothing into a wanted list), and a carried positive displaces a conflicting
 *   inherited label. What lands is the {@link minimalOverride} for that.
 *
 * Every move path — `ritual move`, the editors' cross-list moves, a change
 * bundle's moves — arrives through this one rule. Old payloads that carry
 * only positives read as an opinion on exactly those labels. `sourceType` is
 * `undefined` for a copy no list states anything about (a swap's replacement
 * printing), which simply takes the destination's default.
 */
export function arrivalLabels(
  destType: ListType,
  carried: readonly SignedCardLabel[] | undefined,
  destDefault: readonly CardLabel[] | undefined,
  sourceType: ListType | undefined,
): LabelOverride | undefined {
  if (!supportsAnyLabels(destType)) return undefined
  const accepted = supportedLabels(destType)
  const { add, remove } = labelDelta(carried ?? [])
  const sourceStatesProxy =
    sourceType !== undefined && supportedLabels(sourceType).includes('proxy')
  const stated = (label: CardLabel): boolean =>
    add.includes(label) || remove.includes(label) || (label === 'proxy' && sourceStatesProxy)
  const kept = add.filter((label) => accepted.includes(label))
  const inherited = (destDefault ?? []).filter(
    (label) => accepted.includes(label) && !stated(label) && !displacedBy(kept, label),
  )
  return minimalOverride(normalizeCardLabels([...kept, ...inherited]), destDefault)
}

/**
 * The exclusive label that makes a combination of *positives* illegal, or
 * `undefined` when the set is legal. The *rule*, with no prose attached: each
 * surface words the refusal from the label this returns — the CLI and the data
 * parsers through the catalog, the card-line grammar as a structured code
 * (`labels-exclusive`) that `card-line-message.ts` words.
 */
export function conflictingExclusiveLabel(labels: readonly CardLabel[]): CardLabel | undefined {
  if (labels.length < 2) return undefined
  return EXCLUSIVE_CARD_LABELS.find((label) => labels.includes(label))
}

/**
 * Why a signed label set cannot be one override: two positives that cannot
 * combine (`exclusive`), or one label both added and taken away
 * (`contradictory`). Negatives combine freely with each other.
 */
export type LabelOverrideConflict = { kind: 'exclusive' | 'contradictory'; label: CardLabel }

/**
 * The rule behind every override refusal, with no prose attached — the grammar
 * returns it as a structured code, the CLI words it through the catalog in its
 * own language, and the data parsers as a message (English plus its key).
 * `labels` are signed members already known to be in the vocabulary.
 */
export function labelOverrideConflict(
  labels: readonly SignedCardLabel[],
): LabelOverrideConflict | undefined {
  const { add, remove } = labelDelta(labels)
  const contradictory = add.find((label) => remove.includes(label))
  if (contradictory !== undefined) return { kind: 'contradictory', label: contradictory }
  const exclusive = conflictingExclusiveLabel(add)
  if (exclusive !== undefined) return { kind: 'exclusive', label: exclusive }
  return undefined
}

/** The localized refusal for a {@link labelOverrideConflict}, or `undefined` for a legal set. */
function localizedConflict(labels: readonly SignedCardLabel[]): string | undefined {
  const conflict = labelOverrideConflict(labels)
  if (conflict === undefined) return undefined
  return conflict.kind === 'exclusive'
    ? t('errors.label.exclusive', { label: conflict.label })
    : t('errors.label.contradictory', { label: conflict.label })
}

/**
 * Parse a comma-separated override value (`trade,no-sale`) as a CLI `--label`
 * takes it, with localized refusals. Case-insensitive like every enum surface
 * (the card-line grammar itself reads only lowercase tokens, and refuses with
 * structured codes); the result is normalized. An empty body, an exclusive
 * combination, and a label both added and negated are refusals.
 */
export function parseLabelOverrideToken(raw: string): LabelOverrideTokenResult {
  const parts = raw.split(',').map((part) => part.trim())
  if (parts.some((part) => part === '')) {
    return {
      ok: false,
      message: t('errors.label.emptyPart', { choices: SIGNED_CARD_LABELS.join(', ') }),
    }
  }
  const labels: SignedCardLabel[] = []
  for (const part of parts) {
    const parsed = parseEnumField(part, SIGNED_CARD_LABELS, '--label')
    if (!parsed.ok) return parsed
    labels.push(parsed.value)
  }
  const conflict = localizedConflict(labels)
  if (conflict) return { ok: false, message: conflict }
  return { ok: true, labels: normalizeLabelOverride(labels) }
}

/**
 * Parse a list's *default* label set from structured data — a front-matter
 * `labels:` value or an HTTP body field. Must be an array of positive label
 * strings (case-insensitive); the result is normalized. An empty array is `ok`
 * with `[]` — callers decide what empty means (front matter treats it as "no
 * default", the metadata route as "clear"). Negations are refused: a default is
 * positive only.
 *
 * Refusals are messages — English plus their key — like
 * {@link parseLabelOverrideData}'s: they name a field in a file or a request
 * body (the metadata route's 400, the front-matter warnings, the CLI's "stored
 * value is invalid" report), and each surface sends the English or renders the
 * key in its reader's language.
 */
export function parseCardLabelsValue(raw: unknown, field: string): CardLabelsResult {
  const read = readLabelValues(raw, field, CARD_LABELS, isCardLabel)
  if (!read.ok) return read
  const { labels } = read
  const exclusive = conflictingExclusiveLabel(labels)
  if (exclusive !== undefined) {
    return { ok: false, error: syncMessage('errors.label.exclusive', { label: exclusive }) }
  }
  return { ok: true, labels: normalizeCardLabels(labels) }
}

/** {@link readLabelValues}' outcome: the labels lowercased, or why `raw` was refused. */
type LabelValues<L extends string> = { ok: true; labels: L[] } | { ok: false; error: SyncMessage }

/**
 * Read `raw` as an array of labels from `vocabulary` (case-insensitive) — the
 * shape check {@link parseCardLabelsValue} and {@link parseLabelOverrideData}
 * share. The choices a refusal names are label tokens, joined the way the file
 * and the flags spell a set.
 */
function readLabelValues<L extends string>(
  raw: unknown,
  field: string,
  vocabulary: readonly L[],
  isMember: (value: string) => value is L,
): LabelValues<L> {
  const choices = vocabulary.join(', ')
  if (!isUnknownArray(raw)) {
    return { ok: false, error: syncMessage('domain.card.label.notArray', { field, choices }) }
  }
  const labels: L[] = []
  for (const element of raw) {
    if (typeof element !== 'string') {
      return { ok: false, error: syncMessage('domain.card.label.notString', { field, choices }) }
    }
    const label = element.toLowerCase()
    if (!isMember(label)) {
      return {
        ok: false,
        error: syncMessage('domain.card.label.invalid', { field, value: element, choices }),
      }
    }
    labels.push(label)
  }
  return { ok: true, labels }
}

/**
 * Parse a signed override from persisted and exchanged data — a changelog's
 * event block, a change bundle, a save request's events. The decoders that
 * report its refusals live inside the persistence fence, so a refusal is a
 * message — English plus its key — never text in the UI locale: the fenced
 * decoder nests it in its own structured problem, and the surface showing that
 * words it. The acceptance rule is the token parser's: signed labels,
 * case-insensitive, normalized, conflicts refused.
 */
export function parseLabelOverrideData(raw: unknown, field: string): LabelOverrideResult {
  const read = readLabelValues(raw, field, SIGNED_CARD_LABELS, isSignedCardLabel)
  if (!read.ok) return read
  const { labels } = read
  const conflict = labelOverrideConflict(labels)
  if (conflict !== undefined) {
    return {
      ok: false,
      error: syncMessage(
        conflict.kind === 'exclusive' ? 'errors.label.exclusive' : 'errors.label.contradictory',
        { label: conflict.label },
      ),
    }
  }
  return { ok: true, labels: normalizeLabelOverride(labels) }
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
  warning?: SyncMessage
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
  const read = readListDefaultLabelsValue(type, raw)
  if ('reason' in read) {
    return {
      warning: syncMessage('domain.card.label.frontMatterDropped', {
        reason: nestSync(read.reason),
      }),
    }
  }
  return read.labels.length === 0 ? {} : { labels: read.labels }
}

/** {@link readListDefaultLabelsValue}' outcome: the default (possibly empty), or why it was refused. */
export type ListDefaultLabelsValue = { labels: CardLabel[] } | { reason: SyncMessage }

/**
 * The one rule for a front-matter `labels:` value: a legal label set (empty
 * meaning "no default") that `type` carries, or the reason it is not. Each
 * reader words the refusal for its own file — a deck drops the key on its next
 * write, a flat list keeps its block verbatim — but they all judge the value
 * here.
 */
export function readListDefaultLabelsValue(type: ListType, raw: unknown): ListDefaultLabelsValue {
  const parsed = parseCardLabelsValue(raw, 'labels')
  if (!parsed.ok) return { reason: parsed.error }
  const unsupported = unsupportedLabelsFor(type, parsed.labels)
  if (unsupported.length > 0) return { reason: unsupportedLabelsMessage(type, unsupported) }
  return { labels: parsed.labels }
}

/**
 * A list's default card labels from its front-matter mapping, or `undefined`
 * when it declares none (or an unreadable one — its readers report that). The
 * one reader behind every "what does a line without an override inherit here?"
 * question: the move engines' staged lists, the CLI sessions, and the save and
 * import paths all ask it, so they cannot disagree about a list's default.
 */
export function listDefaultLabels(
  type: ListType,
  frontMatter: Readonly<Record<string, unknown>> | undefined,
): CardLabel[] | undefined {
  if (frontMatter === undefined || !('labels' in frontMatter)) return undefined
  return readListDefaultLabels(type, frontMatter.labels).labels
}

/**
 * The canonical comma-joined form of a positive label set (`sale,trade`): the
 * file and comparison form. A reader sees {@link cardLabelsDisplay} instead.
 * Ordering is re-normalized so no caller can serialize `trade,sale`.
 */
export function formatCardLabels(labels: readonly CardLabel[]): string {
  return normalizeCardLabels(labels).join(',')
}

/**
 * The canonical comma-joined form of an override (`trade,no-sale`), written to
 * card-line tokens and changelog lines. Input is assumed already validated.
 */
export function formatLabelOverride(labels: readonly SignedCardLabel[]): string {
  return normalizeLabelOverride(labels).join(',')
}

/**
 * Whether two positive label sets are the same: order-insensitive, with an
 * absent set equal to an empty one — the rule behind every effective-labels
 * and default comparison.
 */
export function sameCardLabels(
  a: readonly CardLabel[] | undefined,
  b: readonly CardLabel[] | undefined,
): boolean {
  return formatCardLabels(a ?? []) === formatCardLabels(b ?? [])
}

/**
 * Whether two overrides are the same override, compared canonically with an
 * absent override equal to an empty one — the rule behind every "did the label
 * actually change?" check.
 */
export function sameLabelOverride(
  a: readonly SignedCardLabel[] | undefined,
  b: readonly SignedCardLabel[] | undefined,
): boolean {
  return formatLabelOverride(a ?? []) === formatLabelOverride(b ?? [])
}

/**
 * The effective state a label-picker row asks for: a label set (possibly
 * empty — "No labels"), or `'default'` for the row that clears the override.
 */
export type CardLabelTarget = readonly CardLabel[] | 'default'

/**
 * One pickable row in the label pickers, in menu order. `label` is a message
 * key for the same reason {@link CARD_LABEL_DISPLAY_NAMES} holds keys — the
 * choice lists below are built from module-level constants.
 */
export type CardLabelChoice = { label: CardLabelMessageKey; labels: CardLabelTarget }

/**
 * Every labeled state a picker can offer. The override pickers write the
 * {@link minimalOverride} that gives the picked state under the list's default,
 * so they never author a token the line does not need.
 */
const LABELED_CHOICES = [
  { label: CARD_LABEL_DISPLAY_NAMES.sale, labels: ['sale'] },
  { label: CARD_LABEL_DISPLAY_NAMES.trade, labels: ['trade'] },
  { label: 'domain.label.saleAndTrade', labels: ['sale', 'trade'] },
  { label: CARD_LABEL_DISPLAY_NAMES.keep, labels: ['keep'] },
  { label: CARD_LABEL_DISPLAY_NAMES.proxy, labels: ['proxy'] },
] as const satisfies readonly CardLabelChoice[]

/** The labeled states a list of `type` can hold, in menu order. */
function labeledChoicesFor(type: ListType): CardLabelDefaultChoice[] {
  const supported = supportedLabels(type)
  return LABELED_CHOICES.filter((choice) =>
    choice.labels.every((label) => supported.includes(label)),
  )
}

/**
 * The wording of each type's empty-state row: "Not a proxy" on a deck (its one
 * label), "No labels" on a collection; a wanted list carries no labels.
 */
const EMPTY_LABEL_CHOICE_KEYS = {
  deck: 'domain.label.notProxy',
  collection: 'domain.label.noLabels',
  wanted: undefined,
} as const satisfies Record<ListType, CardLabelMessageKey | undefined>

/**
 * The override rows a picker on a list of `type` offers under `listDefault`:
 * every labeled state that type accepts, an empty state ("No labels"; "Not a
 * proxy" on a deck) when the default gives the card something to take away,
 * and the "Use list default" clear row. A type that carries no labels offers
 * the clear row alone.
 */
export function cardLabelChoicesFor(
  type: ListType,
  listDefault: readonly CardLabel[] | undefined,
): readonly CardLabelChoice[] {
  const labeled = labeledChoicesFor(type)
  const emptyKey = EMPTY_LABEL_CHOICE_KEYS[type]
  const empty: CardLabelChoice[] =
    emptyKey !== undefined && labeled.length > 0 && (listDefault?.length ?? 0) > 0
      ? [{ label: emptyKey, labels: [] }]
      : []
  return [...labeled, ...empty, { label: 'domain.label.useListDefault', labels: 'default' }]
}

/**
 * A picker row's stable value: `default` for the clear row, `none` for the
 * empty state, else the canonical label list (`sale,trade`) — a real domain
 * token rather than a menu position, distinct for every row of a table.
 */
export function labelChoiceKey(target: CardLabelTarget): string {
  if (target === 'default') return 'default'
  return target.length === 0 ? 'none' : formatCardLabels(target)
}

/**
 * The override a picked row writes as a set-label payload: the clear (`[]`)
 * for "Use list default", else the {@link minimalOverride} for the row's state
 * — also the clear when the default already gives it.
 */
export function overrideForChoice(
  target: CardLabelTarget,
  listDefault: readonly CardLabel[] | undefined,
): LabelOverride {
  if (target === 'default') return []
  return minimalOverride(target, listDefault) ?? []
}

/**
 * The row a picker marks current for a card whose override is `override`: the
 * clear row when it has none, else the row whose state equals its effective
 * labels (`undefined` when no row does).
 */
export function currentLabelChoice(
  choices: readonly CardLabelChoice[],
  override: readonly SignedCardLabel[] | undefined,
  listDefault: readonly CardLabel[] | undefined,
): CardLabelChoice | undefined {
  if (normalizedOverride(override) === undefined) {
    return choices.find((choice) => choice.labels === 'default')
  }
  const effective = effectiveLabels(override, listDefault)
  return choices.find(
    (choice) => choice.labels !== 'default' && sameCardLabels(choice.labels, effective),
  )
}

/** One row of the *default*-labels picker: a positive state, or `[]` for "No default". */
export type CardLabelDefaultChoice = { label: CardLabelMessageKey; labels: readonly CardLabel[] }

/**
 * The *default*-labels picker rows for a list of `type` (the admin Default
 * Labels modal and the CLI editor's Edit List Labels action): a leading "No
 * default" clear row, then each labeled state that type accepts.
 */
export function cardLabelDefaultChoicesFor(type: ListType): readonly CardLabelDefaultChoice[] {
  return [{ label: 'domain.label.noDefault', labels: [] }, ...labeledChoicesFor(type)]
}
