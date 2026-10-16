/**
 * What the export engine has to say — why it refused an input, what it could
 * not write — as **structured values**, not sentences.
 *
 * Everything under `src/export/` sits inside the persistence fence (AGENTS.md,
 * "Localization"; the fence scan in `test/unit/i18n-conventions.test.ts`): it
 * writes CSV, JSON and decklists that other tools import, so it may never
 * import `src/i18n`. Its refusals and warnings are still read by people — on
 * the CLI, in the admin Settings page — and by agents over MCP and the admin
 * API. So the engine says *what* happened as a code plus the values the
 * sentence needs (a column id, a preset name, a card name), and the boundary
 * words it: `src/export-wording/message.ts` maps each code to its catalog key
 * and renders it in English (the API, MCP, `--output json`) or in the reader's
 * language (the CLI).
 *
 * Two kinds of text:
 *
 * - a **problem** refuses an input: a column list, a filter value, a saved
 *   preset, or the file a server-written export could not be given;
 * - a **warning** reports something an export did and the user should know: a
 *   list it could not fully read, a card term that matched nothing, a cell the
 *   local card cache could not fill, cards or categories a decklist dialect
 *   left out.
 *
 * The values are the input's own words and the format's own vocabulary — a
 * column id, a filter value as typed, a card or list name, a section name —
 * never prose, so they read the same in every language. A list parser's own
 * warning arrives already a message (English plus its key) and is carried as
 * it is.
 *
 * **Persistence fence — this module must never import `src/i18n`.** Type-only
 * imports, nothing at run time: the export modules import it.
 */

import type { SyncMessage } from '../sync/message'
import type { ExportPreset } from './presets'

/** A code that carries no values. */
type NoParams = Record<never, never>

/** The boolean fields of a saved preset, as its JSON spells them. */
export type ExportPresetBooleanField = {
  [K in keyof ExportPreset]-?: NonNullable<ExportPreset[K]> extends boolean ? K : never
}[keyof ExportPreset]

/**
 * What each problem code carries — the table the codes are read from. `column`
 * and `value` are the offending input as given (`String()`ed when it was not a
 * string); `name` is a saved preset's name as its config key spells it. The
 * values a code *accepts* (the column ids, the condition grades) are the same
 * every time, so the boundary supplies them. `reason` nests the column list's
 * own problem inside a preset's.
 */
export type ExportProblemParams = {
  'columns-empty': NoParams
  'column-unknown': { column: string }
  'column-duplicate': { column: string }
  'conditions-empty': NoParams
  'condition-invalid': { value: string }
  'labels-empty': NoParams
  'label-invalid': { value: string }
  'presets-not-object': NoParams
  'preset-not-object': { name: string }
  'preset-format-invalid': { name: string }
  'preset-columns-not-array': { name: string }
  'preset-columns-invalid': { name: string; reason: ColumnsProblem }
  'preset-field-not-boolean': { name: string; field: ExportPresetBooleanField }
  'preset-dialect-invalid': { name: string }
  /** `dir` is the absolute directory the writer tried. */
  'file-name-exhausted': { attempts: number; dir: string }
  'file-name-not-basename': { name: string }
}

/** One section a decklist dialect left out, and how many cards it held. */
export type OmittedSection = { section: string; quantity: number }

/**
 * What each warning code carries. `list` is a list's file slug and
 * `warning` the list parser's (or categories sidecar's) own message; `name` is
 * a card name and `printing` its `SET:CN` label; `terms` a `--card` / `cards`
 * pick as typed; `sections` and `categories` are in first-seen order.
 */
export type ExportWarningParams = {
  'list-warning': { list: string; warning: SyncMessage }
  'cards-unmatched': { terms: string }
  'scryfall-id-unpinned': { name: string }
  'scryfall-id-uncached': { name: string; printing: string }
  'edhrec-rank-uncached': { name: string }
  'extras-omitted': { sections: readonly OmittedSection[] }
  'categories-unwritable': { categories: readonly string[] }
}

export type ExportProblemCode = keyof ExportProblemParams
export type ExportWarningCode = keyof ExportWarningParams

/** Each row of a params table as `{ code, params }`, unioned. */
type Coded<Params> = { [C in keyof Params]: CodedValue<C, Params[C]> }[keyof Params]

/** Why an export input was refused: a code and the values it needs. */
export type ExportProblem = Coded<ExportProblemParams>

/** Something an export reports beside its output: a code and the values it needs. */
export type ExportWarning = Coded<ExportWarningParams>

/** The problems with code `C`. */
export type ExportProblemOf<C extends ExportProblemCode> = Extract<ExportProblem, { code: C }>

/** The warning with code `C`. */
export type ExportWarningOf<C extends ExportWarningCode> = Extract<ExportWarning, { code: C }>

/** Why a column list was refused. */
export type ColumnsProblem = ExportProblemOf<
  'columns-empty' | 'column-unknown' | 'column-duplicate'
>

/** Why a condition-filter list was refused. */
export type ConditionsProblem = ExportProblemOf<'conditions-empty' | 'condition-invalid'>

/** Why a labels-filter list was refused. */
export type LabelsProblem = ExportProblemOf<'labels-empty' | 'label-invalid'>

/** Why the `exportPresets` setting was refused. */
export type PresetsProblem = ExportProblemOf<
  | 'presets-not-object'
  | 'preset-not-object'
  | 'preset-format-invalid'
  | 'preset-columns-not-array'
  | 'preset-columns-invalid'
  | 'preset-field-not-boolean'
  | 'preset-dialect-invalid'
>

/** Why a server-written export could not be given a file. */
export type FileNameProblem = ExportProblemOf<'file-name-exhausted' | 'file-name-not-basename'>

/** Whether `T` is a union of more than one member. */
type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never

/**
 * `[]` for a code that carries nothing, `[params]` otherwise — for one literal
 * code at a time (a union is refused outright, as `[never]`: over codes whose
 * params share no key, `keyof` would collapse and the params turn optional).
 */
type ParamsArgs<Params, C extends keyof Params> =
  true extends IsUnion<C> ? [never] : [keyof Params[C]] extends [never] ? [] : [params: Params[C]]

/** A code and the values it carries — one row of a params table. */
type CodedValue<C, P> = { code: C; params: P }

/** A `{ code, params }` value, its params `{}` when the code carries none. */
function coded<C, P>(code: C, args: readonly unknown[]): CodedValue<C, P> {
  const [params = {}] = args as readonly [P?]
  return { code, params: params as P }
}

/** Build an {@link ExportProblem}. */
export function exportProblem<C extends ExportProblemCode>(
  code: C,
  ...args: ParamsArgs<ExportProblemParams, C>
): ExportProblemOf<C> {
  return coded(code, args) as ExportProblemOf<C>
}

/** Build an {@link ExportWarning}. */
export function exportWarning<C extends ExportWarningCode>(
  code: C,
  ...args: ParamsArgs<ExportWarningParams, C>
): ExportWarningOf<C> {
  return coded(code, args) as ExportWarningOf<C>
}

/** A parse's refusal: why the input was not accepted. */
export type ExportRefusal<P extends ExportProblem = ExportProblem> = { ok: false; problem: P }

/** The outcome of an export parser: the value, or why it was refused. */
export type ExportParsed<T, P extends ExportProblem = ExportProblem> =
  { ok: true; value: T } | ExportRefusal<P>

/** Refuse with `problem`. */
export function refuseExport<P extends ExportProblem>(problem: P): ExportRefusal<P> {
  return { ok: false, problem }
}
