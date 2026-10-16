/**
 * Why a change bundle, a changelog event or a save request was refused — as a
 * **structured value**, not a sentence.
 *
 * The validators that judge externally authored change JSON (`change-bundle.ts`,
 * `change-event-decode.ts`, `wire-changes.ts`, `changelog-blocks.ts`) sit inside
 * the persistence fence: they must never import `src/i18n`, because the files
 * they read and write are a data format. Their refusals are still read by
 * people, though — on the CLI, in the admin and public editors — and by agents
 * over MCP. So a validator says *what* went wrong as a machine code plus the
 * values it needs (a field name, an index, the offending token), and the
 * boundary that shows it words it: `change-problem-message.ts` maps each code
 * to its catalog key and renders the problem in English (for the API and MCP)
 * or in the reader's language (the CLI, the SPAs).
 *
 * Two kinds of problem:
 *
 * - a **document** problem is about the input as a whole, or about one entry of
 *   a bundle's `lists` array (`Not valid JSON.`, `List #2: Missing or invalid
 *   "slug".`);
 * - a **located** problem is about one record — a change, a move, or one of
 *   their nested objects — and its sentence is a predicate of that record's
 *   {@link ChangeProblemSite} (`Move #1 "from" is not an object.`).
 *
 * **Persistence fence — this module must never import `src/i18n`** (asserted by
 * `test/unit/i18n-conventions.test.ts`); the fenced validators import it.
 */

// Type-only: erased at run time, so this module still loads nothing.
import type { SyncText } from '../sync/message'

/** Codes for a problem with the input as a whole, or with one `lists` entry of a bundle. */
export const DOCUMENT_PROBLEM_CODES = [
  'json-invalid',
  'json-not-object',
  'bundle-format-missing',
  'bundle-version-unsupported',
  'bundle-field-invalid',
  'bundle-array-invalid',
  'bundle-line-break',
  'bundle-list-not-object',
  'bundle-list-kind-invalid',
  'bundle-list-field-invalid',
  'bundle-list-array-invalid',
  'bundle-list-field-malformed',
  'save-changes-not-array',
  'save-too-many',
] as const

/** Codes for a problem with one record: a change, a move, or a nested object of one. */
export const LOCATED_PROBLEM_CODES = [
  'not-object',
  'action-unknown',
  'field-missing',
  'field-invalid',
  'line-break',
  'action-field-missing',
  'category-card-id',
  'list-action-card-name',
  'printing-half',
  'value-unknown',
  'list-type-invalid',
  'list-kind-invalid',
  'replacement-condition',
  'replacement-printing-missing',
  'replacement-unpinned',
  'move-in-changes',
  'move-same-list',
  'move-pin-without-target',
  'move-replacement-unpinned',
  'field-rejected',
] as const

/** Every problem code, document and located. */
export const CHANGE_PROBLEM_CODES = [...DOCUMENT_PROBLEM_CODES, ...LOCATED_PROBLEM_CODES] as const

export type DocumentProblemCode = (typeof DOCUMENT_PROBLEM_CODES)[number]
export type LocatedProblemCode = (typeof LOCATED_PROBLEM_CODES)[number]
export type ChangeProblemCode = (typeof CHANGE_PROBLEM_CODES)[number]

/** The document and located codes never share a code: a code says which kind it is. */
type CodesOverlap = Extract<DocumentProblemCode, LocatedProblemCode>
const CODES_DISJOINT: [CodesOverlap] extends [never] ? true : CodesOverlap = true
void CODES_DISJOINT

/**
 * The JSON fields of a change, a bundle move, or one of their nested objects
 * (a move's other end, a replacement) that a located problem may name.
 */
export type ChangeFieldName =
  | 'id'
  | 'timestamp'
  | 'cardName'
  | 'cardId'
  | 'set'
  | 'collectorNumber'
  | 'finish'
  | 'language'
  | 'labels'
  | 'tag'
  | 'note'
  | 'section'
  | 'newSection'
  | 'categories'
  | 'category'
  | 'newCategory'
  | 'order'
  | 'to'
  | 'from'
  | 'sourceCardId'
  | 'replacesCardId'
  | 'replacement'
  | 'name'
  | 'slug'
  | 'toCardId'
  | 'pinsCardId'

/** The JSON fields of a change bundle, or of one of its `lists` entries, a document problem may name. */
export type BundleFieldName =
  'exportedAt' | 'lists' | 'moves' | 'slug' | 'name' | 'changes' | 'baseContentHash'

/** The closed-vocabulary fields a `value-unknown` problem may name. */
export type UnknownValueField = 'language' | 'finish' | 'condition' | 'board'

/** A code that carries no values. */
type NoParams = Record<never, never>

/**
 * What each code carries. Field names and paths are the JSON keys the input
 * used (`set`, `moves[0].cardName`); `value` / `kind` / `action` / `version`
 * are the offending input as the message shows it — JSON-quoted for a
 * closed-vocabulary value (`value-unknown`), as written otherwise.
 * Positions (`list`) are 1-based, as the message shows them. `detail` is a
 * refusal another module's parser raised (a label, tag or category rule),
 * nested as an unrendered message so it is worded with the problem around it.
 */
export type ChangeProblemParams = {
  'json-invalid': NoParams
  'json-not-object': NoParams
  'bundle-format-missing': { format: string }
  'bundle-version-unsupported': { version: string }
  'bundle-field-invalid': { field: BundleFieldName }
  'bundle-array-invalid': { field: BundleFieldName }
  'bundle-line-break': { path: string }
  'bundle-list-not-object': { list: number }
  'bundle-list-kind-invalid': { list: number; kind: string }
  'bundle-list-field-invalid': { list: number; field: BundleFieldName }
  'bundle-list-array-invalid': { list: number; field: BundleFieldName }
  'bundle-list-field-malformed': { list: number; field: BundleFieldName }
  'save-changes-not-array': NoParams
  'save-too-many': { count: number; received: number }
  'not-object': NoParams
  'action-unknown': { action: string }
  'field-missing': { field: ChangeFieldName }
  'field-invalid': { field: ChangeFieldName }
  'line-break': { path: string }
  'action-field-missing': { action: string; field: ChangeFieldName }
  'category-card-id': { action: string }
  'list-action-card-name': { action: string }
  'printing-half': NoParams
  'value-unknown': { field: UnknownValueField; value: string }
  'list-type-invalid': { value: string }
  'list-kind-invalid': { value: string }
  'replacement-condition': NoParams
  'replacement-printing-missing': NoParams
  'replacement-unpinned': NoParams
  'move-in-changes': { action: string }
  'move-same-list': NoParams
  'move-pin-without-target': NoParams
  'move-replacement-unpinned': NoParams
  'field-rejected': { detail: SyncText }
}

/** A params row per code, and no row that is not a code. */
type ParamsCoverCodes = [keyof ChangeProblemParams] extends [ChangeProblemCode]
  ? [ChangeProblemCode] extends [keyof ChangeProblemParams]
    ? true
    : never
  : never
const PARAMS_COVER_CODES: ParamsCoverCodes = true
void PARAMS_COVER_CODES

/**
 * The record a located problem is about. Positions are what the input's reader
 * counts: 1-based for a bundle's lists, changes and moves and a history
 * rewrite's sets and events, the array index for a save request's `changes`.
 */
export type ChangeProblemSubject =
  /** One event with no position to name (a `ritual-changes` block line). */
  | { kind: 'change' }
  /** A change in a bundle list's `changes` array. */
  | { kind: 'bundle-change'; list: number; change: number }
  /** A move in a bundle's top-level `moves` array. */
  | { kind: 'bundle-move'; move: number }
  /** An event in a save request's `changes` array. */
  | { kind: 'save-change'; index: number }
  /** An event in a history rewrite's change set. */
  | { kind: 'history-event'; set: number; event: number }

/** A nested object of a record that a problem may be about instead of the record itself. */
export type ChangeProblemPart = 'from' | 'to' | 'replacement'

/** Where a located problem is: a record, or one of its nested objects. */
export type ChangeProblemSite = {
  subject: ChangeProblemSubject
  part?: ChangeProblemPart
}

/** A problem with the input as a whole (or one bundle `lists` entry). */
export type DocumentProblem = {
  [C in DocumentProblemCode]: { code: C; params: ChangeProblemParams[C] }
}[DocumentProblemCode]

/** A problem with one record, at {@link ChangeProblemSite}. */
export type LocatedProblem = {
  [C in LocatedProblemCode]: { code: C; site: ChangeProblemSite; params: ChangeProblemParams[C] }
}[LocatedProblemCode]

/** The shape a problem with code `C` is picked out of its union by. */
type WithCode<C> = { code: C }

/** The document problem with code `C`. */
export type DocumentProblemOf<C extends DocumentProblemCode> = Extract<DocumentProblem, WithCode<C>>

/** The located problem with code `C`. */
export type LocatedProblemOf<C extends LocatedProblemCode> = Extract<LocatedProblem, WithCode<C>>

/** Why change JSON was refused: a code, what it needs, and (located) where. */
export type ChangeProblem = DocumentProblem | LocatedProblem

/**
 * `[]` for a code that carries nothing, `[params]` otherwise. Meant for one
 * literal code at a time: over a union of codes whose params differ, `keyof`
 * collapses and the params would turn optional.
 */
type ParamsArgs<C extends ChangeProblemCode> = [keyof ChangeProblemParams[C]] extends [never]
  ? []
  : [params: ChangeProblemParams[C]]

/** Build a {@link DocumentProblem}. */
export function documentProblem<C extends DocumentProblemCode>(
  code: C,
  ...args: ParamsArgs<C>
): DocumentProblemOf<C> {
  const [params = {}] = args as readonly [ChangeProblemParams[C]?]
  return { code, params } as DocumentProblemOf<C>
}

/** Build a {@link LocatedProblem} at `site`. */
export function locatedProblem<C extends LocatedProblemCode>(
  code: C,
  site: ChangeProblemSite,
  ...args: ParamsArgs<C>
): LocatedProblemOf<C> {
  const [params = {}] = args as readonly [ChangeProblemParams[C]?]
  return { code, site, params } as LocatedProblemOf<C>
}

/** `site`'s record with `part` named — `Move #1` → `Move #1 "from"`. */
export function partOf(site: ChangeProblemSite, part: ChangeProblemPart): ChangeProblemSite {
  return { subject: site.subject, part }
}

/** A validator's refusal: why the input was not accepted. */
export type ChangeProblemRefusal = { ok: false; problem: ChangeProblem }

/** The outcome of a validator: the value, or why it was refused. */
export type ChangeProblemResult<T> = { ok: true; value: T } | ChangeProblemRefusal

/** Refuse with `problem`. */
export function refuse(problem: ChangeProblem): ChangeProblemRefusal {
  return { ok: false, problem }
}
