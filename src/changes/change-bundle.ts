import type { Condition, Finish } from '../card/finish-condition'
import type {
  AddChange,
  ChangeEvent,
  ListRef,
  MovedCopyFields,
  MoveFromChange,
  MoveReplacement,
  MoveToChange,
} from './change-event'
import { movedCopyOf } from './change-event'
import type { CardLanguage } from '../card/card-language'
import {
  decodeChangeEvent,
  definedFields,
  isCardIdValue,
  validateMovedCopyFields,
  validatePrintingFields,
  validateReplacement,
} from './change-event-decode'
import { sameListName } from '../list/list-file-name'
import type { ListType } from '../list/list-type'
import { LIST_TYPES } from '../list/list-type'
import { findLineBreak } from '../util/single-line'
import {
  documentProblem,
  locatedProblem,
  partOf,
  refuse,
  type ChangeFieldName,
  type ChangeProblemResult,
  type ChangeProblemSite,
  type ChangeProblemSubject,
} from './change-problem'

/** The `format` marker every change bundle carries — what tells it from unrelated JSON. */
export const CHANGE_BUNDLE_FORMAT = 'ritual-change-bundle'

/** The bundle shape version. Bump only on incompatible shape changes. */
export const CHANGE_BUNDLE_VERSION = 3

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
 *
 * The copy's payload — tags, carried labels, note — is {@link MovedCopyFields},
 * each omitted from the JSON when absent (the parsed object still has the key,
 * set to `undefined`).
 */
export type ChangeBundleMove = MovedCopyFields & {
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
    ...movedCopyOf(change),
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
    ...movedCopyOf(change),
    cardId: change.sourceCardId,
    toCardId: change.cardId,
    section: change.section,
    pinsCardId: change.replacesCardId,
    replacement: change.replacement,
  }
}

const NO_SLUG: ResolveListSlug = () => undefined

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
    ...movedCopyOf(move),
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
    ...movedCopyOf(move),
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
 * Validate a raw `changes` value as an ordered {@link ChangeEvent} array, for
 * the bundle's 1-based list `list`. Move events are refused here: a bundle
 * records moves once, in its top-level `moves` array. Each event is judged by
 * the shared {@link decodeChangeEvent}, with labels checked against the list
 * type.
 */
function validateChanges(
  raw: unknown,
  list: number,
  kind: ListType,
): ChangeProblemResult<ChangeEvent[]> {
  if (!Array.isArray(raw)) {
    return refuse(documentProblem('bundle-list-array-invalid', { list, field: 'changes' }))
  }
  const changes: ChangeEvent[] = []
  for (const [i, change] of raw.entries()) {
    const subject: ChangeProblemSubject = { kind: 'bundle-change', list, change: i + 1 }
    const event = decodeChangeEvent(change, subject, { listType: kind })
    if (!event.ok) return event
    if (event.value.action === 'move-from' || event.value.action === 'move-to') {
      return refuse(locatedProblem('move-in-changes', { subject }, { action: event.value.action }))
    }
    changes.push(event.value)
  }
  return { ok: true, value: changes }
}

/** Validate one entry of a bundle's `lists` array — 1-based position `list`. */
function validateList(
  obj: Record<string, unknown>,
  list: number,
): ChangeProblemResult<ChangeBundleList> {
  if (typeof obj.kind !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.kind)) {
    return refuse(documentProblem('bundle-list-kind-invalid', { list, kind: String(obj.kind) }))
  }
  if (typeof obj.slug !== 'string') {
    return refuse(documentProblem('bundle-list-field-invalid', { list, field: 'slug' }))
  }
  if (typeof obj.name !== 'string') {
    return refuse(documentProblem('bundle-list-field-invalid', { list, field: 'name' }))
  }
  if (obj.baseContentHash !== undefined && typeof obj.baseContentHash !== 'string') {
    return refuse(
      documentProblem('bundle-list-field-malformed', { list, field: 'baseContentHash' }),
    )
  }
  const kind = obj.kind as ListType
  const changes = validateChanges(obj.changes, list, kind)
  if (!changes.ok) return changes
  return {
    ok: true,
    value: {
      kind,
      slug: obj.slug,
      name: obj.name,
      baseContentHash: obj.baseContentHash,
      changes: changes.value,
    },
  }
}

/** Validate one end of a move (`from` / `to`, the move's `part`). */
function validateMoveRef(
  raw: unknown,
  move: ChangeProblemSite,
  part: 'from' | 'to',
): ChangeProblemResult<ChangeBundleListRef> {
  const site = partOf(move, part)
  if (typeof raw !== 'object' || raw === null) return refuse(locatedProblem('not-object', site))
  const obj = raw as Record<string, unknown>
  if (typeof obj.kind !== 'string' || !(LIST_TYPES as readonly string[]).includes(obj.kind)) {
    return refuse(locatedProblem('list-kind-invalid', site, { value: String(obj.kind) }))
  }
  if (typeof obj.name !== 'string') {
    return refuse(locatedProblem('field-missing', site, { field: 'name' }))
  }
  if (obj.slug !== undefined && typeof obj.slug !== 'string') {
    return refuse(locatedProblem('field-invalid', site, { field: 'slug' }))
  }
  const kind = obj.kind as ListType
  return {
    ok: true,
    value:
      obj.slug === undefined ? { kind, name: obj.name } : { kind, slug: obj.slug, name: obj.name },
  }
}

/** Validate a raw `moves` value as an ordered {@link ChangeBundleMove} array. */
function validateMoves(raw: unknown): ChangeProblemResult<ChangeBundleMove[]> {
  if (!Array.isArray(raw)) {
    return refuse(documentProblem('bundle-array-invalid', { field: 'moves' }))
  }
  const moves: ChangeBundleMove[] = []
  for (const [i, move] of raw.entries()) {
    const site: ChangeProblemSite = { subject: { kind: 'bundle-move', move: i + 1 } }
    const fieldProblem = (code: 'field-missing' | 'field-invalid', field: ChangeFieldName) =>
      refuse(locatedProblem(code, site, { field }))
    if (typeof move !== 'object' || move === null) return refuse(locatedProblem('not-object', site))
    const obj = move as Record<string, unknown>
    if (typeof obj.id !== 'string') return fieldProblem('field-missing', 'id')
    if (typeof obj.timestamp !== 'number') return fieldProblem('field-missing', 'timestamp')
    if (typeof obj.cardName !== 'string') return fieldProblem('field-missing', 'cardName')
    const from = validateMoveRef(obj.from, site, 'from')
    if (!from.ok) return from
    const to = validateMoveRef(obj.to, site, 'to')
    if (!to.ok) return to
    if (obj.cardId !== undefined && !isCardIdValue(obj.cardId)) {
      return fieldProblem('field-invalid', 'cardId')
    }
    if (obj.toCardId !== undefined && !isCardIdValue(obj.toCardId)) {
      return fieldProblem('field-invalid', 'toCardId')
    }
    if (sameBundleList(from.value, to.value)) {
      return refuse(locatedProblem('move-same-list', site))
    }
    if (obj.section !== undefined && typeof obj.section !== 'string') {
      return fieldProblem('field-invalid', 'section')
    }
    if (obj.pinsCardId !== undefined && !isCardIdValue(obj.pinsCardId)) {
      return fieldProblem('field-invalid', 'pinsCardId')
    }
    // Without the landing id a pin would read as a split (a copy off the line
    // onto a fresh id) rather than the in-place conversion it may have been.
    if (obj.pinsCardId !== undefined && obj.toCardId === undefined) {
      return refuse(locatedProblem('move-pin-without-target', site))
    }
    // A replacement is the pinning move's option: any other move handing a
    // source list a printing would be a free card.
    if (obj.replacement !== undefined && obj.pinsCardId === undefined) {
      return refuse(locatedProblem('move-replacement-unpinned', site))
    }
    const printing = validatePrintingFields(obj, site, { conditionClearAllowed: false })
    if (!printing.ok) return printing
    const replacement = validateReplacement(obj.replacement, site)
    if (!replacement.ok) return replacement
    const moved = validateMovedCopyFields(obj, site)
    if (!moved.ok) return moved
    moves.push({
      id: obj.id,
      timestamp: obj.timestamp,
      cardName: obj.cardName,
      from: from.value,
      to: to.value,
      ...printing.value,
      ...moved.value,
      cardId: obj.cardId,
      toCardId: obj.toCardId,
      section: obj.section,
      pinsCardId: obj.pinsCardId,
      replacement: replacement.value,
    })
  }
  return { ok: true, value: moves }
}

/**
 * Parse and validate a {@link ChangeBundle} from JSON text: the bundle, or the
 * {@link ChangeProblem} saying why it was rejected — the caller words it for
 * its reader (`change-problem-message.ts`). Card IDs referenced by the changes
 * are NOT resolved here; re-targeting against the live lists happens at import
 * time.
 */
export function parseChangeBundle(text: string): ChangeProblemResult<ChangeBundle> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return refuse(documentProblem('json-invalid'))
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return refuse(documentProblem('json-not-object'))
  }
  const obj = raw as Record<string, unknown>
  if (obj.format !== CHANGE_BUNDLE_FORMAT) {
    return refuse(documentProblem('bundle-format-missing', { format: CHANGE_BUNDLE_FORMAT }))
  }
  if (obj.version !== CHANGE_BUNDLE_VERSION) {
    return refuse(documentProblem('bundle-version-unsupported', { version: String(obj.version) }))
  }
  if (typeof obj.exportedAt !== 'string') {
    return refuse(documentProblem('bundle-field-invalid', { field: 'exportedAt' }))
  }
  if (!Array.isArray(obj.lists)) {
    return refuse(documentProblem('bundle-array-invalid', { field: 'lists' }))
  }
  const lists: ChangeBundleList[] = []
  for (const [i, entry] of obj.lists.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return refuse(documentProblem('bundle-list-not-object', { list: i + 1 }))
    }
    const list = validateList(entry as Record<string, unknown>, i + 1)
    if (!list.ok) return list
    lists.push(list.value)
  }
  // Moves are validated here rather than through `decodeChangeEvent` (which
  // refuses line breaks for every list's changes), so they get the same check.
  const brokenMove = findLineBreak(obj.moves, 'moves')
  if (brokenMove !== null) {
    return refuse(documentProblem('bundle-line-break', { path: brokenMove }))
  }
  const moves = validateMoves(obj.moves)
  if (!moves.ok) return moves
  return {
    ok: true,
    value: {
      format: CHANGE_BUNDLE_FORMAT,
      version: CHANGE_BUNDLE_VERSION,
      exportedAt: obj.exportedAt,
      lists,
      moves: moves.value,
    },
  }
}
