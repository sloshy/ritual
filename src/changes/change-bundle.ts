import { type Condition, type Finish, isCondition, isFinish } from '../card/finish-condition'
import type {
  AddChange,
  ChangeAction,
  ChangeEvent,
  ListRef,
  MoveFromChange,
  MoveReplacement,
  MoveToChange,
} from './change-event'
import { CHANGE_ACTIONS } from './change-event'
import {
  checkLabelsForListType,
  parseCardLabelsValue,
  unsupportedLabelsMessage,
} from '../card/card-labels'
import { isCardLanguage, type CardLanguage } from '../card/card-language'
import { sameListName } from '../list/list-file-name'
import type { ListType } from '../list/list-type'
import { LIST_TYPES } from '../list/list-type'

/** The `format` marker every change bundle carries — what tells it from unrelated JSON. */
export const CHANGE_BUNDLE_FORMAT = 'ritual-change-bundle'

/** The bundle shape version. Bump only on incompatible shape changes. */
export const CHANGE_BUNDLE_VERSION = 2

/**
 * One list's worth of changes inside a {@link ChangeBundle}. A single-list
 * export is simply a bundle with one entry.
 */
export type ChangeBundleList = {
  /** Which list type these changes target. */
  kind: ListType
  /** Slug of the source list (best-effort target hint for import). */
  slug: string
  /** Display name of the source list, for human-friendly import prompts. */
  name: string
  /** Content hash of the source list at export time, when known. */
  baseContentHash?: string
  /**
   * The ordered edit events to replay. Never contains `move-from` / `move-to`:
   * cross-list moves are normalized into {@link ChangeBundle.moves}.
   */
  changes: ChangeEvent[]
}

/**
 * How a bundle names one end of a move. `slug` is a best-effort hint (the
 * browser fills it when it knows the list); `name` is what the import resolves
 * by when the slug is absent or stale — the same rule as a list entry.
 */
export type ChangeBundleListRef = {
  kind: ListType
  slug?: string
  name: string
}

/**
 * One physical copy moving between two lists. A move is semantically different
 * from a per-list change — it always has a source and a destination — so it is
 * recorded once, here, rather than as a `move-from` in one list's changes and a
 * `move-to` in the other's. The changelog files still record both halves; the
 * bundle is the normalized form.
 */
export type ChangeBundleMove = {
  id: string
  timestamp: number
  cardName: string
  from: ChangeBundleListRef
  to: ChangeBundleListRef
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The moved copy's language. Omitted means English (the bare-line default). */
  language?: CardLanguage
  /**
   * The SOURCE list's line id the copy was taken from, when known — a removal
   * hint; the importer falls back to a name + printing match.
   */
  cardId?: number
  /**
   * The DESTINATION line id the editor gave the arriving copy, when the move
   * was recorded on the destination side. Re-targeted on import exactly like an
   * `add`'s id, so a later edit of that copy in the same export still finds it.
   */
  toCardId?: number
  /** Destination section (decks). */
  section?: string
  /**
   * The DESTINATION's name-only line this copy pins instead of adding a copy
   * (see `MoveToChange.replacesCardId`): equal to `toCardId` when the line is
   * converted in place, otherwise the line one copy is taken off before it
   * lands on `toCardId`. Re-targeted on import like any edit's id.
   */
  pinsCardId?: number
  /** The printing the SOURCE list receives back for the copy (see `MoveToChange.replacement`). */
  replacement?: MoveReplacement
}

/**
 * The exported/imported edit-session envelope: one or more lists' pending
 * changes plus every cross-list move that touches them, exported together. A
 * public-site visitor edits their lists and exports this; it is later applied by
 * the CLI (`ritual import-changes`), the admin Import Changes page, the MCP
 * `import_change_bundle` tool, or loaded into an editor as pending edits
 * (re-targeted to the current card IDs). The `format` marker guards against
 * importing unrelated JSON, and each list's `baseContentHash` lets an importer
 * warn when the underlying list has changed since export.
 */
export type ChangeBundle = {
  /** Format marker + version (see {@link CHANGE_BUNDLE_FORMAT}, {@link CHANGE_BUNDLE_VERSION}). */
  format: typeof CHANGE_BUNDLE_FORMAT
  version: typeof CHANGE_BUNDLE_VERSION
  /** ISO timestamp the bundle was exported. */
  exportedAt: string
  /** One entry per edited list, in export order. */
  lists: ChangeBundleList[]
  /** Every cross-list move touching an exported list, one entry per copy, in timestamp order. */
  moves: ChangeBundleMove[]
}

/** The normalized halves of a set of edit sessions. */
export type NormalizedChangeGroups = {
  lists: ChangeBundleList[]
  moves: ChangeBundleMove[]
}

/** The normalized halves plus the export time — injected by the caller so the build stays pure/testable. */
type BuildChangeBundleInput = NormalizedChangeGroups & { exportedAt: string }

/** Build a {@link ChangeBundle} from already-normalized lists and moves. */
export function buildChangeBundle(input: BuildChangeBundleInput): ChangeBundle {
  return {
    format: CHANGE_BUNDLE_FORMAT,
    version: CHANGE_BUNDLE_VERSION,
    exportedAt: input.exportedAt,
    lists: input.lists,
    moves: input.moves,
  }
}

/** Resolve a list's slug from its type + display name, when the caller knows it. */
export type ResolveListSlug = (ref: ListRef) => string | undefined

/** A browser edit session's stack, as the export surfaces hold it (structurally a list entry). */
export type ChangeGroup = ChangeBundleList

function bundleRefOf(group: ChangeGroup): ChangeBundleListRef {
  return { kind: group.kind, slug: group.slug, name: group.name }
}

function bundleRefFromListRef(ref: ListRef, resolveSlug: ResolveListSlug): ChangeBundleListRef {
  const slug = resolveSlug(ref)
  return slug === undefined
    ? { kind: ref.type, name: ref.name }
    : { kind: ref.type, slug, name: ref.name }
}

function moveFromOutgoing(
  group: ChangeGroup,
  change: MoveFromChange,
  resolveSlug: ResolveListSlug,
): ChangeBundleMove {
  return {
    id: change.id,
    timestamp: change.timestamp,
    cardName: change.cardName,
    from: bundleRefOf(group),
    to: bundleRefFromListRef(change.to, resolveSlug),
    set: change.set,
    collectorNumber: change.collectorNumber,
    finish: change.finish,
    condition: change.condition,
    language: change.language,
    cardId: change.cardId,
  }
}

function moveFromIncoming(
  group: ChangeGroup,
  change: MoveToChange,
  resolveSlug: ResolveListSlug,
): ChangeBundleMove {
  return {
    id: change.id,
    timestamp: change.timestamp,
    cardName: change.cardName,
    from: bundleRefFromListRef(change.from, resolveSlug),
    to: bundleRefOf(group),
    set: change.set,
    collectorNumber: change.collectorNumber,
    finish: change.finish,
    condition: change.condition,
    language: change.language,
    cardId: change.sourceCardId,
    toCardId: change.cardId,
    section: change.section,
    pinsCardId: change.replacesCardId,
    replacement: change.replacement,
  }
}

const NO_SLUG: ResolveListSlug = () => undefined

/** The fields of `obj` whose value is defined, as a partial overlay. */
function definedFields<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  return out
}

/** Of two refs to one list end, the one that knows the slug (the later when both or neither do). */
function preferSlugged(
  earlier: ChangeBundleListRef,
  later: ChangeBundleListRef,
): ChangeBundleListRef {
  return later.slug !== undefined || earlier.slug === undefined ? later : earlier
}

/**
 * One move recorded on both of its lists, merged field by field: every defined
 * field of the later half overlays the earlier, so `cardId` (which only the
 * source half may know) and `toCardId` / `section` (which only the destination
 * half carries) each survive from whichever half has them. Each end's ref is
 * taken from the half that knows its slug — the half recorded ON a list
 * always does, the far end only when the resolver did.
 */
function mergeMoveHalves(earlier: ChangeBundleMove, later: ChangeBundleMove): ChangeBundleMove {
  return {
    ...earlier,
    ...definedFields(later),
    from: preferSlugged(earlier.from, later.from),
    to: preferSlugged(earlier.to, later.to),
  }
}

/** A group with its moves lifted out, awaiting the replacement-add fold. */
type PendingGroup = { group: ChangeGroup; changes: ChangeEvent[] }

/**
 * Split the browser's per-list change stacks into the bundle's normalized
 * halves: every `move-from` in list L becomes a move `L → to`, every `move-to`
 * in L becomes a move `from → L`, and the lists keep only their non-move
 * changes (an entry is kept even when nothing but moves remains, so the export
 * still names every edited list). Moves are sorted by timestamp and deduped by
 * event id: the editors record each move on one side only (the swap wizard
 * writes both halves into the edited list's stack, "Move to list" a `move-from`
 * on the source), but a bundle loaded into BOTH of a move's lists materializes
 * the same move — same id — on each side, and re-exporting must not double it.
 * When both halves are present they are merged ({@link mergeMoveHalves}).
 */
export function normalizeChangeGroups(
  groups: readonly ChangeGroup[],
  resolveSlug: ResolveListSlug = NO_SLUG,
): NormalizedChangeGroups {
  const lists: ChangeBundleList[] = []
  const byId = new Map<string, ChangeBundleMove>()
  const put = (move: ChangeBundleMove): void => {
    const existing = byId.get(move.id)
    byId.set(move.id, existing ? mergeMoveHalves(existing, move) : move)
  }
  const pending: PendingGroup[] = []
  for (const group of groups) {
    const changes: ChangeEvent[] = []
    for (const change of group.changes) {
      if (change.action === 'move-from') put(moveFromOutgoing(group, change, resolveSlug))
      else if (change.action === 'move-to') put(moveFromIncoming(group, change, resolveSlug))
      else changes.push(change)
    }
    pending.push({ group, changes })
  }
  // The `add` a source editor showed for a move's replacement folds back into
  // the move when the destination half (which carries the replacement) is
  // present too; on its own it stays a real add, so the source still gets it.
  for (const { group, changes } of pending) {
    lists.push({
      ...group,
      changes: changes.filter((change) => {
        if (change.action !== 'add' || !change.id.endsWith(REPLACEMENT_ADD_SUFFIX)) return true
        const move = byId.get(change.id.slice(0, -REPLACEMENT_ADD_SUFFIX.length))
        return move?.replacement === undefined
      }),
    })
  }
  const moves = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
  return { lists, moves }
}

/** Build a bundle straight from edit-session stacks (normalizing their moves). */
export function bundleFromChangeGroups(
  groups: readonly ChangeGroup[],
  exportedAt: string,
  resolveSlug: ResolveListSlug = NO_SLUG,
): ChangeBundle {
  return buildChangeBundle({ ...normalizeChangeGroups(groups, resolveSlug), exportedAt })
}

/**
 * Whether a bundle-side list ref *locates* the given list: same kind, and
 * either the slugs agree (both known) or the names do ({@link sameListName},
 * folded). Either key finds a list — the public site slugifies display names
 * for its URLs while the admin keys by file basename, so a bundle from one
 * surface can still be matched on the other, and a renamed list is still found
 * by its slug. This is the lookup predicate; {@link sameBundleList} is the
 * identity one.
 */
export function bundleRefMatches(ref: ChangeBundleListRef, list: ChangeBundleListRef): boolean {
  if (ref.kind !== list.kind) return false
  if (ref.slug !== undefined && list.slug !== undefined && ref.slug === list.slug) return true
  return sameListName(ref.name, list.name)
}

/**
 * Whether two bundle-side refs *are* the same list: same kind, and — when both
 * know their slug — the same slug; otherwise the same (folded) name. Unlike
 * {@link bundleRefMatches}, two lists that share a display name under
 * different slugs are different lists here. Used wherever a bundle's lists are
 * counted or a move's two ends compared, never to find a list by a hint.
 */
export function sameBundleList(a: ChangeBundleListRef, b: ChangeBundleListRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.slug !== undefined && b.slug !== undefined) return a.slug === b.slug
  return sameListName(a.name, b.name)
}

/** A ref copied without an explicit-`undefined` slug key (a parsed move ref never has one). */
function cloneRef(ref: ChangeBundleListRef): ChangeBundleListRef {
  return ref.slug === undefined
    ? { kind: ref.kind, name: ref.name }
    : { kind: ref.kind, slug: ref.slug, name: ref.name }
}

/**
 * Every list a bundle touches, in first-seen order: its `lists` entries in
 * export order, then each move's source and destination (a "This list" export
 * carries the moves that leave it, whose far ends have no entry of their own).
 * Deduplicated by identity ({@link sameBundleList}).
 */
export function bundleTargets(bundle: ChangeBundle): ChangeBundleListRef[] {
  const targets: ChangeBundleListRef[] = []
  const add = (ref: ChangeBundleListRef): void => {
    if (!targets.some((target) => sameBundleList(target, ref))) targets.push(cloneRef(ref))
  }
  for (const list of bundle.lists) add(list)
  for (const move of bundle.moves) {
    add(move.from)
    add(move.to)
  }
  return targets
}

function listRefOf(ref: ChangeBundleListRef): ListRef {
  return { type: ref.kind, name: ref.name }
}

/** The outgoing half of a bundle move, as the source list's editor stack records it. */
export function moveFromEventOf(move: ChangeBundleMove): MoveFromChange {
  return {
    id: move.id,
    timestamp: move.timestamp,
    action: 'move-from',
    cardName: move.cardName,
    cardId: move.cardId,
    set: move.set,
    collectorNumber: move.collectorNumber,
    finish: move.finish,
    condition: move.condition,
    language: move.language,
    to: listRefOf(move.to),
  }
}

/**
 * The incoming half of a bundle move, as the destination list's editor stack
 * records it. `cardId` is the exported destination id when the move carried one
 * (so the import re-target can remap later edits of that copy, exactly as for
 * an `add`); the import allocates the line's real id either way.
 */
export function moveToEventOf(move: ChangeBundleMove): MoveToChange {
  return {
    id: move.id,
    timestamp: move.timestamp,
    action: 'move-to',
    cardName: move.cardName,
    cardId: move.toCardId,
    set: move.set,
    collectorNumber: move.collectorNumber,
    finish: move.finish,
    condition: move.condition,
    language: move.language,
    from: listRefOf(move.from),
    section: move.section,
    sourceCardId: move.cardId,
    replacesCardId: move.pinsCardId,
    replacement: move.replacement,
  }
}

/**
 * The id of the `add` a source list's editor shows for a move's replacement
 * (see {@link ChangeBundleMove.replacement}): the move's own id with a marker
 * suffix, so a re-export can tell it from a real add and fold it back into the
 * move rather than doubling it.
 */
export function replacementAddId(moveId: string): string {
  return `${moveId}${REPLACEMENT_ADD_SUFFIX}`
}

const REPLACEMENT_ADD_SUFFIX = '#replacement'

/** The `add` a source list's editor stack shows for the replacement a move brings it. */
export function replacementAddEventOf(move: ChangeBundleMove): AddChange | null {
  if (!move.replacement) return null
  return {
    id: replacementAddId(move.id),
    timestamp: move.timestamp,
    action: 'add',
    cardName: move.cardName,
    set: move.replacement.set,
    collectorNumber: move.replacement.collectorNumber,
    finish: move.replacement.finish,
    language: move.replacement.language,
  }
}

/**
 * Denormalize a bundle for ONE list: that list's own changes plus a `move-from`
 * for every move leaving it and a `move-to` for every move arriving, merged by
 * timestamp. This is what an editor loads as pending edits — its view needs
 * both halves to show the list as the bundle leaves it. Returns `null` when the
 * bundle names no such list and no move touches it.
 */
export function listChangesFromBundle(
  bundle: ChangeBundle,
  list: ChangeBundleListRef,
): ChangeEvent[] | null {
  const entry = bundle.lists.find((l) => bundleRefMatches(l, list))
  const events: ChangeEvent[] = entry ? [...entry.changes] : []
  let touched = entry !== undefined
  for (const move of bundle.moves) {
    if (bundleRefMatches(move.from, list)) {
      events.push(moveFromEventOf(move))
      const replacement = replacementAddEventOf(move)
      if (replacement) events.push(replacement)
      touched = true
    }
    if (bundleRefMatches(move.to, list)) {
      events.push(moveToEventOf(move))
      touched = true
    }
  }
  if (!touched) return null
  // `Array.prototype.sort` is stable (ES2019), so same-timestamp events keep
  // their recorded order: the list's own changes first, then the moves.
  return events.sort((a, b) => a.timestamp - b.timestamp)
}

/** Serialize a {@link ChangeBundle} to pretty JSON suitable for download/clipboard. */
export function serializeChangeBundle(bundle: ChangeBundle): string {
  return JSON.stringify(bundle, null, 2)
}

/** Filename for a downloaded multi-list change bundle (every edited list). */
export const CHANGE_BUNDLE_FILENAME = 'ritual-all-edits.json'

/** Filename for a bundle scoped to the current combined view's member lists. */
export const COMBINED_BUNDLE_FILENAME = 'ritual-combined-edits.json'

/** Total change count across every list in a bundle: its moves, and the replacement adds they carry, included. */
export function bundleChangeCount(bundle: ChangeBundle): number {
  const replacements = bundle.moves.filter((move) => move.replacement !== undefined).length
  return (
    bundle.lists.reduce((sum, list) => sum + list.changes.length, 0) +
    bundle.moves.length +
    replacements
  )
}

/**
 * How many distinct lists an import touches: every `lists[]` entry plus any
 * list named only as a move endpoint ({@link bundleTargets}). The count the
 * confirm prompts quote.
 */
export function bundleListCount(bundle: ChangeBundle): number {
  return bundleTargets(bundle).length
}

/** The moves of a bundle that touch (leave or arrive at) any of the given lists. */
export function movesTouching(
  moves: readonly ChangeBundleMove[],
  lists: readonly ChangeBundleListRef[],
): ChangeBundleMove[] {
  return moves.filter((m) =>
    lists.some((l) => bundleRefMatches(m.from, l) || bundleRefMatches(m.to, l)),
  )
}

/**
 * Format a count with a simple pluralized noun (`1 change`, `3 lists`).
 *
 * **Being retired.** A runtime noun with an English `s` glued on has no string
 * a translator can edit, and is wrong in every language with more than two
 * plural categories — which is why `ritual/no-inline-plural` flags the body.
 * The browser surfaces now render `ui.count.changes` / `ui.count.lists`
 * instead; the one remaining caller is `src/admin/api/import-changes.ts`, whose
 * server-authored prose is restructured in Phase 5 (plan §7.7). This function
 * goes away with it.
 */
export function countLabel(count: number, noun: string): string {
  // eslint-disable-next-line ritual/no-inline-plural -- see the retirement note above
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Which vocabulary relaxations apply when validating printing fields. */
type PrintingFieldRules = {
  /** `set-printing` alone accepts the `NONE` condition-clear sentinel. */
  conditionClearAllowed: boolean
}

/** The printing-ish fields of a change or move once validated (set and language folded to lowercase). */
type ValidatedPrintingFields = Pick<
  ChangeBundleMove,
  'set' | 'collectorNumber' | 'finish' | 'condition' | 'language'
>

type PrintingFieldsResult =
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
function validatePrintingFields(
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

/**
 * The field each action must carry beyond the shared `id` / `timestamp` /
 * `cardName`. Moves are listed for completeness of the table but are refused
 * before it is consulted (a bundle records them in `moves`). The `satisfies`
 * makes a new {@link ChangeAction} a compile error here until its row exists.
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

/**
 * Validate a raw `changes` value as an ordered {@link ChangeEvent} array. Returns
 * the array on success or a human-readable error string prefixed with the list's
 * position (e.g. `List #2: `). Move events are refused here: a bundle records
 * moves once, in its top-level `moves` array.
 */
function validateChanges(raw: unknown, where: string, kind: ListType): ChangeEvent[] | string {
  if (!Array.isArray(raw)) return `${where}Missing or invalid "changes" array.`
  const changes: ChangeEvent[] = []
  for (const [i, change] of raw.entries()) {
    if (typeof change !== 'object' || change === null) {
      return `${where}Change #${i + 1} is not an object.`
    }
    const obj = change as Record<string, unknown>
    if (
      typeof obj.action !== 'string' ||
      !(CHANGE_ACTIONS as readonly string[]).includes(obj.action)
    ) {
      return `${where}Change #${i + 1} has an unknown action: ${String(obj.action)}.`
    }
    const action = obj.action as ChangeAction
    const here = `${where}Change #${i + 1} `
    if (action === 'move-from' || action === 'move-to') {
      return `${here}is a ${action}; moves belong in the top-level "moves" array.`
    }
    // The envelope every change carries: its id, its time, and — for every
    // card-bearing action — the card it names.
    if (typeof obj.id !== 'string') return `${here}is missing its "id".`
    if (typeof obj.timestamp !== 'number') return `${here}is missing its "timestamp".`
    if (!SECTION_META_ACTIONS.has(action) && typeof obj.cardName !== 'string') {
      return `${here}is missing its "cardName".`
    }
    if (obj.cardId !== undefined && typeof obj.cardId !== 'number') {
      return `${here}has an invalid "cardId".`
    }
    for (const field of REQUIRED_CHANGE_FIELDS[action]) {
      if (obj[field] === undefined) return `${here}(${action}) is missing its "${field}".`
      if (STRING_CHANGE_FIELDS.has(field) && typeof obj[field] !== 'string') {
        return `${here}has an invalid "${field}".`
      }
    }
    const printing = validatePrintingFields(obj, here, {
      conditionClearAllowed: action === 'set-printing',
    })
    if (!printing.ok) return printing.error
    // Only the fields present on the input are rewritten (normalized), so an
    // absent field stays absent rather than becoming an explicit `undefined`.
    let normalized: Record<string, unknown> = { ...obj }
    if (printing.fields.set !== undefined) normalized.set = printing.fields.set
    if (printing.fields.language !== undefined) normalized.language = printing.fields.language
    // A labels payload is a closed vocabulary with an exclusivity rule —
    // imported JSON must not smuggle garbage into a serialize. The parsed form
    // is normalized (deduped, canonical order). On a set-label an empty array
    // (a clear) is valid; an add (or the record of the line a remove took away)
    // either carries an override or omits the field.
    if (
      obj.action === 'set-label' ||
      ((obj.action === 'add' || obj.action === 'remove') && obj.labels !== undefined)
    ) {
      const labels = parseCardLabelsValue(obj.labels, 'labels')
      if (!labels.ok) return `${where}Change #${i + 1}: ${labels.message}`
      // Which labels are legal depends on the list the change lands in: a deck
      // carries `proxy` alone, a wanted list none at all — and an empty set is
      // a clear, which still says nothing on a list with no labels. The same
      // decision the CLI, the save routes, and the MCP schemas make.
      const check = checkLabelsForListType(kind, labels.labels)
      if (!check.ok) {
        return `${where}Change #${i + 1}: ${unsupportedLabelsMessage(kind, check.unsupported)}`
      }
      normalized = { ...normalized, labels: labels.labels }
    }
    // Every field a variant requires has been checked above (envelope, the
    // action's own field, the printing tuple, labels); the cast only restates
    // that for the compiler, since the object was built field by field.
    changes.push(normalized as unknown as ChangeEvent)
  }
  return changes
}

/** Validate one entry of a bundle's `lists` array, or return an error string. */
function validateList(obj: Record<string, unknown>, where: string): ChangeBundleList | string {
  if (typeof obj.kind !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.kind)) {
    return `${where}Invalid list kind: ${String(obj.kind)} (expected deck, collection, or wanted).`
  }
  if (typeof obj.slug !== 'string') return `${where}Missing or invalid "slug".`
  if (typeof obj.name !== 'string') return `${where}Missing or invalid "name".`
  if (obj.baseContentHash !== undefined && typeof obj.baseContentHash !== 'string') {
    return `${where}Invalid "baseContentHash".`
  }
  const kind = obj.kind as ListType
  const changes = validateChanges(obj.changes, where, kind)
  if (typeof changes === 'string') return changes
  return {
    kind,
    slug: obj.slug,
    name: obj.name,
    baseContentHash: obj.baseContentHash,
    changes,
  }
}

/** Validate one end of a move (`from` / `to`), or return an error string. */
function validateMoveRef(raw: unknown, where: string): ChangeBundleListRef | string {
  if (typeof raw !== 'object' || raw === null) return `${where}is not an object.`
  const obj = raw as Record<string, unknown>
  if (typeof obj.kind !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.kind)) {
    return `${where}has an invalid list kind: ${String(obj.kind)} (expected deck, collection, or wanted).`
  }
  if (typeof obj.name !== 'string') return `${where}is missing its "name".`
  if (obj.slug !== undefined && typeof obj.slug !== 'string')
    return `${where}has an invalid "slug".`
  const kind = obj.kind as ListType
  return obj.slug === undefined
    ? { kind, name: obj.name }
    : { kind, slug: obj.slug, name: obj.name }
}

/** Validate a move's optional `replacement`: a full printing (set + collector number, optional finish/language). */
function validateReplacement(raw: unknown, where: string): MoveReplacement | undefined | string {
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

/** Validate a raw `moves` value as an ordered {@link ChangeBundleMove} array, or return an error string. */
function validateMoves(raw: unknown): ChangeBundleMove[] | string {
  if (!Array.isArray(raw)) return 'Missing or invalid "moves" array.'
  const moves: ChangeBundleMove[] = []
  for (const [i, move] of raw.entries()) {
    const where = `Move #${i + 1} `
    if (typeof move !== 'object' || move === null) return `${where}is not an object.`
    const obj = move as Record<string, unknown>
    if (typeof obj.id !== 'string') return `${where}is missing its "id".`
    if (typeof obj.timestamp !== 'number') return `${where}is missing its "timestamp".`
    if (typeof obj.cardName !== 'string') return `${where}is missing its "cardName".`
    const from = validateMoveRef(obj.from, `${where}"from" `)
    if (typeof from === 'string') return from
    const to = validateMoveRef(obj.to, `${where}"to" `)
    if (typeof to === 'string') return to
    if (obj.cardId !== undefined && typeof obj.cardId !== 'number') {
      return `${where}has an invalid "cardId".`
    }
    if (obj.toCardId !== undefined && typeof obj.toCardId !== 'number') {
      return `${where}has an invalid "toCardId".`
    }
    if (sameBundleList(from, to)) {
      return `${where}names the same list as source and destination.`
    }
    if (obj.section !== undefined && typeof obj.section !== 'string') {
      return `${where}has an invalid "section".`
    }
    if (obj.pinsCardId !== undefined && typeof obj.pinsCardId !== 'number') {
      return `${where}has an invalid "pinsCardId".`
    }
    // Without the landing id a pin would read as a split (a copy off the line
    // onto a fresh id) rather than the in-place conversion it may have been.
    if (obj.pinsCardId !== undefined && obj.toCardId === undefined) {
      return `${where}has a "pinsCardId" but no "toCardId"; a pinning move must name the line the copy lands on.`
    }
    // A replacement is the pinning move's option: any other move handing a
    // source list a printing would be a free card.
    if (obj.replacement !== undefined && obj.pinsCardId === undefined) {
      return `${where}has a "replacement" but no "pinsCardId"; only a pinning move carries one.`
    }
    const printing = validatePrintingFields(obj, where, { conditionClearAllowed: false })
    if (!printing.ok) return printing.error
    const replacement = validateReplacement(obj.replacement, where)
    if (typeof replacement === 'string') return replacement
    moves.push({
      id: obj.id,
      timestamp: obj.timestamp,
      cardName: obj.cardName,
      from,
      to,
      ...printing.fields,
      cardId: obj.cardId,
      toCardId: obj.toCardId,
      section: obj.section,
      pinsCardId: obj.pinsCardId,
      replacement,
    })
  }
  return moves
}

/**
 * Parse and validate a {@link ChangeBundle} from JSON text. Returns the bundle
 * on success or a human-readable error string describing why it was rejected —
 * the caller surfaces it to the importer. Card IDs referenced by the changes are
 * NOT resolved here; re-targeting against the live lists happens at import time.
 *
 * The rejection strings are **English by contract**: they name JSON field names
 * and index positions in a file the user is expected to inspect, and the same
 * text is what `ritual import-changes` and the MCP import tool report. They are
 * a diagnostic vocabulary for a data format, like the format marker itself, not
 * UI prose — see the plan's §4.9 carve-out list.
 */
export function parseChangeBundle(text: string): ChangeBundle | string {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'Not valid JSON.'
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'Expected a JSON object.'
  }
  const obj = raw as Record<string, unknown>
  if (obj.format !== CHANGE_BUNDLE_FORMAT) {
    return `Not a ritual change bundle (missing "format": "${CHANGE_BUNDLE_FORMAT}").`
  }
  if (obj.version !== CHANGE_BUNDLE_VERSION) {
    return `Unsupported change-bundle version: ${String(obj.version)}.`
  }
  if (typeof obj.exportedAt !== 'string') return 'Missing or invalid "exportedAt".'
  if (!Array.isArray(obj.lists)) return 'Missing or invalid "lists" array.'
  const lists: ChangeBundleList[] = []
  for (const [i, entry] of obj.lists.entries()) {
    if (typeof entry !== 'object' || entry === null) return `List #${i + 1} is not an object.`
    const list = validateList(entry as Record<string, unknown>, `List #${i + 1}: `)
    if (typeof list === 'string') return list
    lists.push(list)
  }
  const moves = validateMoves(obj.moves)
  if (typeof moves === 'string') return moves
  return {
    format: CHANGE_BUNDLE_FORMAT,
    version: CHANGE_BUNDLE_VERSION,
    exportedAt: obj.exportedAt,
    lists,
    moves,
  }
}
