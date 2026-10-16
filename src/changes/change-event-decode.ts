/**
 * The JSON codec for {@link ChangeEvent}: one validator for every externally
 * authored event (a `ritual-change-bundle` file, the `ritual-changes` block in
 * a `.changes.md` entry, an admin `rewrite_history` body) and the single
 * serializer that writes an event as one deterministic JSON line.
 *
 * **Persistence fence — this module must never import `src/i18n`.** The JSON
 * keys are a machine contract (they are what `changelog-blocks.ts` re-reads).
 * A refusal is a structured {@link ChangeProblem} — a code, the field or value
 * it names, and the record it is about — which the surface showing it words in
 * its reader's language (`change-problem-message.ts`). Asserted by
 * `test/unit/i18n-conventions.test.ts`.
 */

import { type Condition, type Finish, isCondition, isFinish } from '../card/finish-condition'
import { isCardLanguage, type CardLanguage } from '../card/card-language'
import {
  checkLabelsForListType,
  parseLabelOverrideData,
  unsupportedLabelsMessage,
  type LabelOverride,
} from '../card/card-labels'
import { parseCardTag, parseCardTagsValue, type CardTag } from '../card/card-tags'
import { parseCardCategoriesValue, parseCardCategory } from '../card/card-categories'
import { BOARDS } from '../list/deck'
import type { ListType } from '../list/list-type'
import { LIST_TYPES } from '../list/list-type'
import type {
  ChangeAction,
  ChangeEvent,
  ListRef,
  MovedCopyFields,
  MoveReplacement,
} from './change-event'
import { CATEGORY_ACTIONS, CHANGE_ACTIONS, movedCopyOf } from './change-event'
import { findLineBreak } from '../util/single-line'
import { nestSync, type SyncMessage } from '../sync/message'
import {
  locatedProblem,
  partOf,
  refuse,
  type ChangeFieldName,
  type ChangeProblemRefusal,
  type ChangeProblemResult,
  type ChangeProblemSite,
  type ChangeProblemSubject,
  type UnknownValueField,
} from './change-problem'

// ── Validation ────────────────────────────────────────────────────────

/**
 * The field each action must carry beyond the shared `id` / `timestamp` /
 * `cardName`. The `satisfies` makes a new {@link ChangeAction} a compile error
 * here until its row exists.
 */
const REQUIRED_CHANGE_FIELDS = {
  add: [],
  remove: [],
  'set-commander': [],
  'unset-commander': [],
  'set-finish': ['finish'],
  'set-printing': [],
  'set-language': ['language'],
  'set-note': ['note'],
  'set-label': ['labels'],
  'add-tag': ['tag'],
  'remove-tag': ['tag'],
  'move-from': ['to'],
  'move-to': ['from'],
  'add-section': ['section'],
  'remove-section': ['section'],
  'rename-section': ['section', 'newSection'],
  'set-section': ['section'],
  'set-categories': ['categories'],
  'rename-category': ['category', 'newCategory'],
  'set-category-order': ['order'],
} as const satisfies Record<ChangeAction, readonly string[]>

/** Required fields that must be strings (the rest are validated by their own parsers). */
const STRING_CHANGE_FIELDS: ReadonlySet<string> = new Set([
  'note',
  'section',
  'newSection',
  'category',
  'newCategory',
])

/** The three category actions, as a membership test. */
const CATEGORY_ACTION_SET: ReadonlySet<ChangeAction> = new Set<ChangeAction>(CATEGORY_ACTIONS)

/**
 * The actions that target a section, or the list's category vocabulary, rather
 * than a card — so they carry no `cardName`. `set-categories` is deliberately
 * absent: it names a card (by name, never by `&N`).
 */
const SECTION_META_ACTIONS: ReadonlySet<ChangeAction> = new Set<ChangeAction>([
  'add-section',
  'remove-section',
  'rename-section',
  'rename-category',
  'set-category-order',
])

/** {@link validateMovedCopyFields}' outcome: the payload in its stored form, or why it was refused. */
export type MovedCopyFieldsResult = ChangeProblemResult<MovedCopyFields>

/**
 * Validate the payload riding with a moved copy ({@link MovedCopyFields}) on a
 * move event or a change bundle's move, and return it in its stored form
 * (`movedCopyOf`: canonical, empty folded to absent). Every refusal is about
 * the record at `site`.
 *
 * Labels (signed, as the source states them) are checked against the
 * vocabulary and the conflict rules only,
 * never a list type: they describe the copy in its source list, and the
 * destination filters them on arrival — a `sale` copy moving into a deck is
 * expected, not malformed. A note is free text, like a `set-note`'s (the line
 * break check is the caller's walk over the whole object).
 */
export function validateMovedCopyFields(
  obj: Record<string, unknown>,
  site: ChangeProblemSite,
): MovedCopyFieldsResult {
  let tags: CardTag[] | undefined
  if (obj.tags !== undefined) {
    const parsed = parseCardTagsValue(obj.tags, '"tags"')
    if (!parsed.ok) return rejected(site, parsed.error)
    tags = parsed.tags
  }
  let labels: LabelOverride | undefined
  if (obj.labels !== undefined) {
    const parsed = parseLabelOverrideData(obj.labels, '"labels"')
    if (!parsed.ok) return rejected(site, parsed.error)
    labels = parsed.labels
  }
  if (obj.note !== undefined && typeof obj.note !== 'string') {
    return invalidField(site, 'note')
  }
  return { ok: true, value: movedCopyOf({ tags, labels, note: obj.note }) }
}

/** The refusal for a `field` of the record at `site` that holds an unusable value. */
function invalidField(site: ChangeProblemSite, field: ChangeFieldName): ChangeProblemRefusal {
  return refuse(locatedProblem('field-invalid', site, { field }))
}

/**
 * The refusal another module's parser raised (a label, tag or category rule),
 * nested unrendered so the surface showing the problem words it, rule and all,
 * in its reader's language.
 */
function rejected(site: ChangeProblemSite, detail: SyncMessage): ChangeProblemRefusal {
  return refuse(locatedProblem('field-rejected', site, { detail: nestSync(detail) }))
}

/**
 * The fields of `obj` whose value is defined, as a partial overlay — so a
 * decoded event never gains an explicit `undefined` key, and a merge of two
 * halves of one move never lets an absent field erase a present one.
 */
export function definedFields<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  return out
}

/** Which optional numeric ids a `move-to` may carry beyond `cardId`. */
const MOVE_TO_ID_FIELDS = ['sourceCardId', 'replacesCardId'] as const

/**
 * Whether `value` can be an `&N`: a positive integer. Anything else would write
 * a token the line reader cannot read back (`&1.5`, `&-1`), turning the list
 * unreadable on its next load.
 */
export function isCardIdValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** How a caller wants the printing-ish fields judged. */
export type PrintingFieldRules = {
  /** `set-printing` alone accepts the `NONE` condition-clear sentinel. */
  conditionClearAllowed: boolean
}

/** The printing-ish fields of a change or move once validated (set and language folded to lowercase). */
export type ValidatedPrintingFields = {
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  language?: CardLanguage
}

export type PrintingFieldsResult = ChangeProblemResult<ValidatedPrintingFields>

/** The refusal for a closed-vocabulary `field` holding a value outside it. */
function unknownValue(
  site: ChangeProblemSite,
  field: UnknownValueField,
  raw: unknown,
): ChangeProblemRefusal {
  return refuse(locatedProblem('value-unknown', site, { field, value: JSON.stringify(raw) }))
}

/**
 * Validate the printing-ish fields shared by changes and moves (`set`,
 * `collectorNumber`, `language`, `finish`, `condition`), normalizing set codes
 * and language codes to lowercase. Every refusal is about the record at `site`.
 * This is the parse boundary for externally-authored JSON, so every closed
 * vocabulary is checked here — an invalid value must never reach a serializer.
 *
 * Casing is by contract: `set` and `language` fold (a printing is identified
 * case-insensitively project-wide, and language codes are lowercase tokens),
 * while `finish` and `condition` are matched exactly against their vocabularies
 * (`foil`, `NM`) — the same spelling the card-line grammar writes and reads.
 */
export function validatePrintingFields(
  obj: Record<string, unknown>,
  site: ChangeProblemSite,
  opts: PrintingFieldRules,
): PrintingFieldsResult {
  const fields: ValidatedPrintingFields = {}
  if (obj.set !== undefined) {
    if (typeof obj.set !== 'string') return invalidField(site, 'set')
    fields.set = obj.set.toLowerCase()
  }
  if (obj.collectorNumber !== undefined) {
    if (typeof obj.collectorNumber !== 'string') return invalidField(site, 'collectorNumber')
    fields.collectorNumber = obj.collectorNumber
  }
  // A set code or a collector number alone pins nothing (`hasSpecificPrinting`
  // needs both), and a line written from half a printing would read as a
  // name-only line — so the half is refused rather than silently dropped.
  if ((fields.set !== undefined) !== (fields.collectorNumber !== undefined)) {
    return refuse(locatedProblem('printing-half', site))
  }
  if (obj.language !== undefined) {
    const language = typeof obj.language === 'string' ? obj.language.toLowerCase() : null
    if (language === null || !isCardLanguage(language)) {
      return unknownValue(site, 'language', obj.language)
    }
    fields.language = language
  }
  if (obj.finish !== undefined) {
    if (typeof obj.finish !== 'string' || !isFinish(obj.finish)) {
      return unknownValue(site, 'finish', obj.finish)
    }
    fields.finish = obj.finish
  }
  if (obj.condition !== undefined) {
    if (typeof obj.condition === 'string' && isCondition(obj.condition)) {
      fields.condition = obj.condition
    } else if (!(opts.conditionClearAllowed && obj.condition === 'NONE')) {
      // `set-printing` alone accepts the `NONE` clear sentinel (ConditionUpdate),
      // which is left on the raw change rather than copied into the tuple.
      return unknownValue(site, 'condition', obj.condition)
    }
  }
  return { ok: true, value: fields }
}

/**
 * Validate a move's optional `replacement`: a full printing (set + collector
 * number, optional finish/language). `site` is the move the replacement rides
 * on; `value` is `undefined` when the move carries none.
 */
export function validateReplacement(
  raw: unknown,
  site: ChangeProblemSite,
): ChangeProblemResult<MoveReplacement | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'object' || raw === null) return invalidField(site, 'replacement')
  const here = partOf(site, 'replacement')
  if ((raw as Record<string, unknown>).condition !== undefined) {
    return refuse(locatedProblem('replacement-condition', here))
  }
  const printing = validatePrintingFields(raw as Record<string, unknown>, here, {
    conditionClearAllowed: false,
  })
  if (!printing.ok) return printing
  const { set, collectorNumber, finish, language } = printing.value
  if (set === undefined || collectorNumber === undefined) {
    return refuse(locatedProblem('replacement-printing-missing', here))
  }
  const replacement: MoveReplacement = { set, collectorNumber }
  if (finish !== undefined) replacement.finish = finish
  if (language !== undefined) replacement.language = language
  return { ok: true, value: replacement }
}

/** Validate a cross-list move's other end (`to` / `from`, the record's `part`) as a {@link ListRef}. */
function validateListRef(
  raw: unknown,
  site: ChangeProblemSite,
  part: 'to' | 'from',
): ChangeProblemResult<ListRef> {
  const here = partOf(site, part)
  if (typeof raw !== 'object' || raw === null) return refuse(locatedProblem('not-object', here))
  const obj = raw as Record<string, unknown>
  if (typeof obj.type !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.type)) {
    return refuse(locatedProblem('list-type-invalid', here, { value: String(obj.type) }))
  }
  if (typeof obj.name !== 'string') {
    return refuse(locatedProblem('field-missing', here, { field: 'name' }))
  }
  return { ok: true, value: { type: obj.type as ListType, name: obj.name } }
}

/** What a caller can tell {@link decodeChangeEvent} about the event's destination. */
export type DecodeChangeEventOptions = {
  /**
   * The list the event lands in, when known. Label payloads are then checked
   * against what that list type carries (a deck takes `proxy` alone, a wanted
   * list nothing) — the same decision the CLI, the save routes and the MCP
   * schemas make. Unknown (a changelog read with no list in hand) checks the
   * vocabulary alone.
   */
  listType?: ListType
}

/**
 * Validate one raw JSON value as a {@link ChangeEvent}. Returns the event (its
 * `set` / `language` folded to lowercase, its `labels` normalized) or the
 * {@link ChangeProblem} saying why it was refused, located at `subject` — the
 * position the caller's input gives the event (`List #2: Change #3`).
 *
 * Every closed vocabulary is checked here — action, finish, condition,
 * language, labels, board, list type — so nothing this returns can reach a
 * serializer invalid. Keys the event type does not declare are kept as they
 * came: an open payload is the bundle's existing contract.
 */
export function decodeChangeEvent(
  raw: unknown,
  subject: ChangeProblemSubject,
  opts: DecodeChangeEventOptions = {},
): ChangeProblemResult<ChangeEvent> {
  const site: ChangeProblemSite = { subject }
  if (typeof raw !== 'object' || raw === null) return refuse(locatedProblem('not-object', site))
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.action !== 'string' ||
    !(CHANGE_ACTIONS as readonly string[]).includes(obj.action)
  ) {
    return refuse(locatedProblem('action-unknown', site, { action: String(obj.action) }))
  }
  const action = obj.action as ChangeAction
  // The envelope every change carries: its id, its time, and — for every
  // card-bearing action — the card it names.
  if (typeof obj.id !== 'string') return missingField(site, 'id')
  if (typeof obj.timestamp !== 'number') return missingField(site, 'timestamp')
  // Every string an event carries lands in a card line or a changelog prose
  // line, both line-oriented: a break inside one (a card name, a section, a
  // list name) would write forged lines, so it is refused, never folded.
  const broken = findLineBreak(obj, 'change')
  if (broken !== null) return refuse(locatedProblem('line-break', site, { path: broken }))
  if (obj.cardName !== undefined && typeof obj.cardName !== 'string') {
    return invalidField(site, 'cardName')
  }
  if (!SECTION_META_ACTIONS.has(action) && obj.cardName === undefined) {
    return missingField(site, 'cardName')
  }
  if (obj.cardId !== undefined && !isCardIdValue(obj.cardId)) {
    return invalidField(site, 'cardId')
  }
  // Categories are keyed by card NAME in one list, so none of the three actions
  // has a card line to point at. Refuse the id here rather than keeping it (this
  // decoder preserves the keys it does not rewrite): a foreign list's `&N` would
  // otherwise ride an imported event straight into the destination's changelog
  // prose, since `retargetImportedChanges` passes these actions through
  // untouched. Symmetrically, the two list-level actions name no card at all.
  if (CATEGORY_ACTION_SET.has(action) && obj.cardId !== undefined) {
    return refuse(locatedProblem('category-card-id', site, { action }))
  }
  if (SECTION_META_ACTIONS.has(action) && obj.cardName !== undefined) {
    return refuse(locatedProblem('list-action-card-name', site, { action }))
  }
  for (const field of REQUIRED_CHANGE_FIELDS[action]) {
    if (obj[field] === undefined) {
      return refuse(locatedProblem('action-field-missing', site, { action, field }))
    }
    if (STRING_CHANGE_FIELDS.has(field) && typeof obj[field] !== 'string') {
      return invalidField(site, field)
    }
  }
  const printing = validatePrintingFields(obj, site, {
    conditionClearAllowed: action === 'set-printing',
  })
  if (!printing.ok) return printing
  // Only the fields present on the input are rewritten (normalized), so an
  // absent field stays absent rather than becoming an explicit `undefined`.
  let normalized: Record<string, unknown> = { ...obj }
  if (printing.value.set !== undefined) normalized.set = printing.value.set
  if (printing.value.language !== undefined) normalized.language = printing.value.language

  if (action === 'add' || action === 'remove') {
    if (obj.board !== undefined) {
      if (typeof obj.board !== 'string' || !(BOARDS as readonly string[]).includes(obj.board)) {
        return unknownValue(site, 'board', obj.board)
      }
    }
  }
  if ((action === 'add' || action === 'move-to') && obj.section !== undefined) {
    if (typeof obj.section !== 'string') return invalidField(site, 'section')
  }
  if (action === 'move-from') {
    const to = validateListRef(obj.to, site, 'to')
    if (!to.ok) return to
    normalized.to = to.value
  }
  if (action === 'move-to') {
    const from = validateListRef(obj.from, site, 'from')
    if (!from.ok) return from
    normalized.from = from.value
    for (const field of MOVE_TO_ID_FIELDS) {
      if (obj[field] !== undefined && !isCardIdValue(obj[field])) {
        return invalidField(site, field)
      }
    }
    const replacement = validateReplacement(obj.replacement, site)
    if (!replacement.ok) return replacement
    if (replacement.value !== undefined) {
      // The printing the source line gets back replaces *that* line; with no
      // line pinned there is nothing for it to replace.
      if (obj.replacesCardId === undefined) {
        return refuse(locatedProblem('replacement-unpinned', site))
      }
      normalized.replacement = replacement.value
    }
  }
  // A labels payload is a closed signed vocabulary with conflict rules —
  // imported JSON must not smuggle garbage into a serialize. The parsed form
  // is normalized (deduped, canonical order). On a set-label an empty array
  // (a clear) is valid; an add (or the record of the line a remove took away)
  // either carries an override or omits the field.
  if (
    action === 'set-label' ||
    ((action === 'add' || action === 'remove') && obj.labels !== undefined)
  ) {
    const labels = parseLabelOverrideData(obj.labels, 'labels')
    if (!labels.ok) return rejected(site, labels.error)
    if (opts.listType !== undefined) {
      const check = checkLabelsForListType(opts.listType, labels.labels)
      if (!check.ok) {
        return rejected(site, unsupportedLabelsMessage(opts.listType, check.unsupported))
      }
    }
    // An add or remove with an empty override carries none: drop the key, as
    // the tags branch folds an empty tag set, so it never re-encodes as `[]`.
    if (action === 'set-label' || labels.labels.length > 0) {
      normalized = { ...normalized, labels: labels.labels }
    } else {
      const { labels: _empty, ...rest } = normalized
      normalized = rest
    }
  }
  // Either half of a move carries the moved copy's payload (tags, carried
  // labels, note), validated by the one rule a bundle's moves share.
  if (action === 'move-from' || action === 'move-to') {
    const moved = validateMovedCopyFields(obj, site)
    if (!moved.ok) return moved
    const { tags: _t, labels: _l, note: _n, ...rest } = normalized
    normalized = { ...rest, ...definedFields(moved.value) }
  }
  // Tags are an open vocabulary validated by shape: a tag event names one
  // tag-shaped string (`tag`), and an add, a remove, or either half of a move
  // may carry a tag set (`tags`). Judged per *field* rather than per action:
  // unknown keys are kept as they came and re-serialized, so a `tag` or `tags`
  // on any action must be valid or refused. Both land canonical — lowercase,
  // deduplicated, sorted, no sigil.
  if (obj.tag !== undefined) {
    if (typeof obj.tag !== 'string') return invalidField(site, 'tag')
    const tag = parseCardTag(obj.tag)
    if (!tag.ok) return rejected(site, tag.error)
    normalized = { ...normalized, tag: tag.tag }
  }
  // (A move's `tags` were validated with the rest of its payload above.)
  if (obj.tags !== undefined && action !== 'move-from' && action !== 'move-to') {
    const tags = parseCardTagsValue(obj.tags, 'tags')
    if (!tags.ok) return rejected(site, tags.error)
    // An empty set is no set: the stored form is absent (`normalizedTags`), so
    // a decoded add never carries a `[]` the serializers would have to fold.
    const { tags: _dropped, ...withoutTags } = normalized
    normalized = tags.tags.length === 0 ? withoutTags : { ...normalized, tags: tags.tags }
  }
  // Categories are an open vocabulary validated by shape, like tags — but an
  // EMPTY set is meaningful here (it is a *clear*), so it is kept rather than
  // folded to absent, and the order is preserved because the first entry is the
  // card's primary category.
  if (obj.categories !== undefined) {
    const categories = parseCardCategoriesValue(obj.categories, '"categories"')
    if (!categories.ok) return rejected(site, categories.error)
    normalized = { ...normalized, categories: categories.categories }
  }
  if (obj.order !== undefined) {
    const order = parseCardCategoriesValue(obj.order, '"order"')
    if (!order.ok) return rejected(site, order.error)
    normalized = { ...normalized, order: order.categories }
  }
  for (const field of ['category', 'newCategory'] as const) {
    const value = obj[field]
    if (value === undefined) continue
    if (typeof value !== 'string') return invalidField(site, field)
    const parsed = parseCardCategory(value)
    if (!parsed.ok) return rejected(site, parsed.error)
    normalized = { ...normalized, [field]: parsed.category }
  }
  // Every field a variant requires has been checked above (envelope, the
  // action's own field, the printing tuple, the board, the list refs, labels,
  // tags);
  // the cast only restates that for the compiler, since the object was built
  // field by field.
  return { ok: true, value: normalized as unknown as ChangeEvent }
}

/** The refusal for a record at `site` that lacks a `field` it must carry. */
function missingField(site: ChangeProblemSite, field: ChangeFieldName): ChangeProblemRefusal {
  return refuse(locatedProblem('field-missing', site, { field }))
}

// ── Serialization ─────────────────────────────────────────────────────

/** Every key any {@link ChangeEvent} variant declares. */
type KeysOfUnion<T> = T extends unknown ? keyof T : never
type ChangeEventKey = KeysOfUnion<ChangeEvent>

/**
 * The declared key order of a serialized event. Order is part of the
 * on-disk contract: the same event must always produce the same bytes, or a
 * repeat save would churn the changelog's `git diff`. `id` and `timestamp` are
 * deliberately absent — an event's envelope is session bookkeeping, and the
 * entry's `## ` header already carries the time; the reader re-synthesizes
 * both (see `changelog-blocks.ts`).
 */
const SERIALIZED_KEY_ORDER = [
  'action',
  'cardName',
  'cardId',
  'set',
  'collectorNumber',
  'finish',
  'condition',
  'language',
  'labels',
  'tags',
  'tag',
  'categories',
  'board',
  'section',
  'newSection',
  'category',
  'newCategory',
  'order',
  'note',
  'to',
  'from',
  'sourceCardId',
  'replacesCardId',
  'replacement',
] as const satisfies readonly Exclude<ChangeEventKey, 'id' | 'timestamp'>[]

/** The keys the writer never persists. */
type EnvelopeKey = 'id' | 'timestamp'

const PERSISTED_KEYS: ReadonlySet<string> = new Set(SERIALIZED_KEY_ORDER)

/**
 * `raw` reduced to the keys an event persists — {@link SERIALIZED_KEY_ORDER},
 * no envelope. For input that should carry nothing else (a save request's
 * events): the decoder itself keeps undeclared keys, because a change bundle's
 * payload is open, but a stray key on a save would reach the reducers.
 */
export function pickPersistedFields(raw: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (PERSISTED_KEYS.has(key)) picked[key] = value
  }
  return picked
}

/**
 * Compile-time completeness: adding a field to any event variant without a
 * row in {@link SERIALIZED_KEY_ORDER} turns this into `never` and fails the
 * assignment below — a new field can never be silently dropped from the file.
 */
type UnlistedKey = Exclude<ChangeEventKey, (typeof SERIALIZED_KEY_ORDER)[number] | EnvelopeKey>
const EVERY_KEY_IS_LISTED: UnlistedKey extends never ? true : never = true
void EVERY_KEY_IS_LISTED

/** The declared key order of a nested {@link ListRef}. */
const LIST_REF_KEY_ORDER = ['type', 'name'] as const satisfies readonly (keyof ListRef)[]

/** The declared key order of a nested {@link MoveReplacement}. */
const REPLACEMENT_KEY_ORDER = [
  'set',
  'collectorNumber',
  'finish',
  'language',
] as const satisfies readonly (keyof MoveReplacement)[]

/** `source` reduced to `keys`, in that order, with undefined values dropped. */
function orderedFields(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Serialize an event as one line of JSON, keys in {@link SERIALIZED_KEY_ORDER},
 * no `undefined` values, no `id` / `timestamp`, no whitespace. Deterministic by
 * construction: two structurally equal events serialize to identical bytes.
 * The one normalization is a half printing (see below); everything else is
 * written exactly as carried, so the reader gets the event back field for field.
 */
export function encodeChangeEvent(event: ChangeEvent): string {
  const source = event as unknown as Record<string, unknown>
  const ordered = orderedFields(source, SERIALIZED_KEY_ORDER)
  // Half a printing pins nothing (`hasSpecificPrinting` needs both halves), and
  // the decoder refuses a lone half — so an in-memory event carrying one is
  // written as the name-only event it behaves as, exactly as the prose line is.
  if ((ordered.set === undefined) !== (ordered.collectorNumber === undefined)) {
    delete ordered.set
    delete ordered.collectorNumber
  }
  if (event.action === 'move-from') {
    ordered.to = orderedFields(event.to, LIST_REF_KEY_ORDER)
  }
  if (event.action === 'move-to') {
    ordered.from = orderedFields(event.from, LIST_REF_KEY_ORDER)
    if (event.replacement !== undefined) {
      ordered.replacement = orderedFields(event.replacement, REPLACEMENT_KEY_ORDER)
    }
  }
  return JSON.stringify(ordered)
}
