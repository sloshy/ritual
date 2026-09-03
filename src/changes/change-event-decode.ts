/**
 * The JSON codec for {@link ChangeEvent}: one validator for every externally
 * authored event (a `ritual-change-bundle` file, the `ritual-changes` block in
 * a `.changes.md` entry, an admin `rewrite_history` body) and the single
 * serializer that writes an event as one deterministic JSON line.
 *
 * **Persistence fence — this module must never import `src/i18n`.** The JSON
 * keys are a machine contract (they are what `changelog-blocks.ts` re-reads),
 * and the rejection strings name JSON field names in a file the user inspects;
 * both are English by contract, like the change-bundle format marker. Asserted
 * by `test/unit/i18n-conventions.test.ts`.
 */

import { type Condition, type Finish, isCondition, isFinish } from '../card/finish-condition'
import { isCardLanguage, type CardLanguage } from '../card/card-language'
import {
  checkLabelsForListType,
  parseCardLabelsValue,
  unsupportedLabelsMessage,
} from '../card/card-labels'
import { parseCardTag, parseCardTagsValue } from '../card/card-tags'
import { BOARDS } from '../list/deck'
import type { ListType } from '../list/list-type'
import { LIST_TYPES } from '../list/list-type'
import type { ChangeAction, ChangeEvent, ListRef, MoveReplacement } from './change-event'
import { CHANGE_ACTIONS } from './change-event'

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
} as const satisfies Record<ChangeAction, readonly string[]>

/** Required fields that must be strings (the rest are validated by their own parsers). */
const STRING_CHANGE_FIELDS: ReadonlySet<string> = new Set(['note', 'section', 'newSection'])

/** The actions that target a section rather than a card, so carry no `cardName`. */
const SECTION_META_ACTIONS: ReadonlySet<ChangeAction> = new Set<ChangeAction>([
  'add-section',
  'remove-section',
  'rename-section',
])

/** Which optional numeric ids a `move-to` may carry beyond `cardId`. */
const MOVE_TO_ID_FIELDS = ['sourceCardId', 'replacesCardId'] as const

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

export type PrintingFieldsResult =
  | { ok: true; fields: ValidatedPrintingFields }
  | { ok: false; error: string }

/**
 * Validate the printing-ish fields shared by changes and moves (`set`,
 * `collectorNumber`, `language`, `finish`, `condition`), normalizing set codes
 * and language codes to lowercase. `where` prefixes every error. This is the
 * parse boundary for externally-authored JSON, so every closed vocabulary is
 * checked here — an invalid value must never reach a serializer.
 *
 * Casing is by contract: `set` and `language` fold (a printing is identified
 * case-insensitively project-wide, and language codes are lowercase tokens),
 * while `finish` and `condition` are matched exactly against their vocabularies
 * (`foil`, `NM`) — the same spelling the card-line grammar writes and reads.
 */
export function validatePrintingFields(
  obj: Record<string, unknown>,
  where: string,
  opts: PrintingFieldRules,
): PrintingFieldsResult {
  const fields: ValidatedPrintingFields = {}
  if (obj.set !== undefined) {
    if (typeof obj.set !== 'string') return { ok: false, error: `${where}has an invalid "set".` }
    fields.set = obj.set.toLowerCase()
  }
  if (obj.collectorNumber !== undefined) {
    if (typeof obj.collectorNumber !== 'string') {
      return { ok: false, error: `${where}has an invalid "collectorNumber".` }
    }
    fields.collectorNumber = obj.collectorNumber
  }
  // A set code or a collector number alone pins nothing (`hasSpecificPrinting`
  // needs both), and a line written from half a printing would read as a
  // name-only line — so the half is refused rather than silently dropped.
  if ((fields.set !== undefined) !== (fields.collectorNumber !== undefined)) {
    return {
      ok: false,
      error: `${where}names half a printing; "set" and "collectorNumber" must both be present or both absent.`,
    }
  }
  if (obj.language !== undefined) {
    const language = typeof obj.language === 'string' ? obj.language.toLowerCase() : null
    if (language === null || !isCardLanguage(language)) {
      return {
        ok: false,
        error: `${where}has an unknown language: ${JSON.stringify(obj.language)}.`,
      }
    }
    fields.language = language
  }
  if (obj.finish !== undefined) {
    if (typeof obj.finish !== 'string' || !isFinish(obj.finish)) {
      return { ok: false, error: `${where}has an unknown finish: ${JSON.stringify(obj.finish)}.` }
    }
    fields.finish = obj.finish
  }
  if (obj.condition !== undefined) {
    if (typeof obj.condition === 'string' && isCondition(obj.condition)) {
      fields.condition = obj.condition
    } else if (!(opts.conditionClearAllowed && obj.condition === 'NONE')) {
      // `set-printing` alone accepts the `NONE` clear sentinel (ConditionUpdate),
      // which is left on the raw change rather than copied into the tuple.
      return {
        ok: false,
        error: `${where}has an unknown condition: ${JSON.stringify(obj.condition)}.`,
      }
    }
  }
  return { ok: true, fields }
}

/** Validate a move's optional `replacement`: a full printing (set + collector number, optional finish/language). */
export function validateReplacement(
  raw: unknown,
  where: string,
): MoveReplacement | undefined | string {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null) return `${where}has an invalid "replacement".`
  const here = `${where}"replacement" `
  if ((raw as Record<string, unknown>).condition !== undefined) {
    return `${here}must not name a "condition" (a replacement carries no grade).`
  }
  const printing = validatePrintingFields(raw as Record<string, unknown>, here, {
    conditionClearAllowed: false,
  })
  if (!printing.ok) return printing.error
  const { set, collectorNumber, finish, language } = printing.fields
  if (set === undefined || collectorNumber === undefined) {
    return `${here}must name a printing ("set" and "collectorNumber").`
  }
  const replacement: MoveReplacement = { set, collectorNumber }
  if (finish !== undefined) replacement.finish = finish
  if (language !== undefined) replacement.language = language
  return replacement
}

/** Validate a cross-list move's other end (`to` / `from`) as a {@link ListRef}, or return an error string. */
function validateListRef(raw: unknown, where: string): ListRef | string {
  if (typeof raw !== 'object' || raw === null) return `${where}is not an object.`
  const obj = raw as Record<string, unknown>
  if (typeof obj.type !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.type)) {
    return `${where}has an invalid list type: ${String(obj.type)} (expected deck, collection, or wanted).`
  }
  if (typeof obj.name !== 'string') return `${where}is missing its "name".`
  return { type: obj.type as ListType, name: obj.name }
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
 * `set` / `language` folded to lowercase, its `labels` normalized) or a
 * human-readable error string prefixed with `where` (e.g. `List #2: Change #3 `).
 *
 * Every closed vocabulary is checked here — action, finish, condition,
 * language, labels, board, list type — so nothing this returns can reach a
 * serializer invalid. Keys the event type does not declare are kept as they
 * came: an open payload is the bundle's existing contract.
 */
export function decodeChangeEvent(
  raw: unknown,
  where: string,
  opts: DecodeChangeEventOptions = {},
): ChangeEvent | string {
  if (typeof raw !== 'object' || raw === null) return `${where}is not an object.`
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.action !== 'string' ||
    !(CHANGE_ACTIONS as readonly string[]).includes(obj.action)
  ) {
    return `${where}has an unknown action: ${String(obj.action)}.`
  }
  const action = obj.action as ChangeAction
  // The envelope every change carries: its id, its time, and — for every
  // card-bearing action — the card it names.
  if (typeof obj.id !== 'string') return `${where}is missing its "id".`
  if (typeof obj.timestamp !== 'number') return `${where}is missing its "timestamp".`
  if (obj.cardName !== undefined && typeof obj.cardName !== 'string') {
    return `${where}has an invalid "cardName".`
  }
  if (!SECTION_META_ACTIONS.has(action) && obj.cardName === undefined) {
    return `${where}is missing its "cardName".`
  }
  if (obj.cardId !== undefined && typeof obj.cardId !== 'number') {
    return `${where}has an invalid "cardId".`
  }
  for (const field of REQUIRED_CHANGE_FIELDS[action]) {
    if (obj[field] === undefined) return `${where}(${action}) is missing its "${field}".`
    if (STRING_CHANGE_FIELDS.has(field) && typeof obj[field] !== 'string') {
      return `${where}has an invalid "${field}".`
    }
  }
  const printing = validatePrintingFields(obj, where, {
    conditionClearAllowed: action === 'set-printing',
  })
  if (!printing.ok) return printing.error
  // Only the fields present on the input are rewritten (normalized), so an
  // absent field stays absent rather than becoming an explicit `undefined`.
  let normalized: Record<string, unknown> = { ...obj }
  if (printing.fields.set !== undefined) normalized.set = printing.fields.set
  if (printing.fields.language !== undefined) normalized.language = printing.fields.language

  if (action === 'add' || action === 'remove') {
    if (obj.board !== undefined) {
      if (typeof obj.board !== 'string' || !(BOARDS as readonly string[]).includes(obj.board)) {
        return `${where}has an unknown board: ${JSON.stringify(obj.board)}.`
      }
    }
  }
  if ((action === 'add' || action === 'move-to') && obj.section !== undefined) {
    if (typeof obj.section !== 'string') return `${where}has an invalid "section".`
  }
  if (action === 'move-from') {
    const to = validateListRef(obj.to, `${where}"to" `)
    if (typeof to === 'string') return to
    normalized.to = to
  }
  if (action === 'move-to') {
    const from = validateListRef(obj.from, `${where}"from" `)
    if (typeof from === 'string') return from
    normalized.from = from
    for (const field of MOVE_TO_ID_FIELDS) {
      if (obj[field] !== undefined && typeof obj[field] !== 'number') {
        return `${where}has an invalid "${field}".`
      }
    }
    const replacement = validateReplacement(obj.replacement, where)
    if (typeof replacement === 'string') return replacement
    if (replacement !== undefined) normalized.replacement = replacement
  }
  // A labels payload is a closed vocabulary with an exclusivity rule —
  // imported JSON must not smuggle garbage into a serialize. The parsed form
  // is normalized (deduped, canonical order). On a set-label an empty array
  // (a clear) is valid; an add (or the record of the line a remove took away)
  // either carries an override or omits the field.
  if (
    action === 'set-label' ||
    ((action === 'add' || action === 'remove') && obj.labels !== undefined)
  ) {
    const labels = parseCardLabelsValue(obj.labels, 'labels')
    if (!labels.ok) return `${where}${labels.message}`
    if (opts.listType !== undefined) {
      const check = checkLabelsForListType(opts.listType, labels.labels)
      if (!check.ok) return `${where}${unsupportedLabelsMessage(opts.listType, check.unsupported)}`
    }
    normalized = { ...normalized, labels: labels.labels }
  }
  // Tags are an open vocabulary validated by shape: a tag event names one
  // tag-shaped string (`tag`), and an add, a remove, or either half of a move
  // may carry a tag set (`tags`). Judged per *field* rather than per action:
  // unknown keys are kept as they came and re-serialized, so a `tag` or `tags`
  // on any action must be valid or refused. Both land canonical — lowercase,
  // deduplicated, sorted, no sigil.
  if (obj.tag !== undefined) {
    if (typeof obj.tag !== 'string') return `${where}has an invalid "tag".`
    const tag = parseCardTag(obj.tag)
    if (!tag.ok) return `${where}${tag.message}`
    normalized = { ...normalized, tag: tag.tag }
  }
  if (obj.tags !== undefined) {
    const tags = parseCardTagsValue(obj.tags, 'tags')
    if (!tags.ok) return `${where}${tags.message}`
    // An empty set is no set: the stored form is absent (`normalizedTags`), so
    // a decoded add never carries a `[]` the serializers would have to fold.
    const { tags: _dropped, ...withoutTags } = normalized
    normalized = tags.tags.length === 0 ? withoutTags : { ...normalized, tags: tags.tags }
  }
  // Every field a variant requires has been checked above (envelope, the
  // action's own field, the printing tuple, the board, the list refs, labels,
  // tags);
  // the cast only restates that for the compiler, since the object was built
  // field by field.
  return normalized as unknown as ChangeEvent
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
  'board',
  'section',
  'newSection',
  'note',
  'to',
  'from',
  'sourceCardId',
  'replacesCardId',
  'replacement',
] as const satisfies readonly Exclude<ChangeEventKey, 'id' | 'timestamp'>[]

/** The keys the writer never persists. */
type EnvelopeKey = 'id' | 'timestamp'

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
