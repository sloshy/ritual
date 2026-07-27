/**
 * Request parsing shared by the admin sync endpoints — `deck-sync` and
 * `collection-sync`.
 *
 * Both surfaces accept the same request twice over: as a JSON body on the `POST`
 * that runs a sync, and as a query string on the `GET` that streams one, because
 * `EventSource` can only issue a bodyless request. The rules that must not drift
 * between them — and between the two syncs — live here:
 *
 * - a direction and a change filter are string enums, matched case-insensitively
 *   the way the CLI's `parseEnumFlag` matches them;
 * - the list of things to sync is an array of names, trimmed, with the blanks a
 *   form control leaves behind dropped;
 * - boolean flags are **validated, never coerced**: they decide whether files
 *   are written and unreadable lines deleted, so an unrecognized value is
 *   refused rather than quietly read as "no".
 *
 * Every function reports a refusal as the message explaining it, per the
 * project's parser convention.
 */

import { isRecord } from '../../json'
import {
  SYNC_CHANGE_FILTERS,
  SYNC_DIRECTIONS,
  type SyncChangeFilter,
  type SyncDirection,
} from '../../sync-common'

// The only shape a request body may take. Re-exported rather than restated so
// this module and the wire parsers narrow unknown JSON the same way.
export { isRecord }

/** The outcome of {@link parseEnumField}: the canonical member, or why it was refused. */
export type EnumFieldResult<T extends string> =
  | { ok: true; value: T }
  | { ok: false; message: string }

/**
 * Match a value against a string enum case-insensitively, as the CLI's
 * `parseEnumFlag` does, so the same spelling is accepted whichever surface it is
 * typed into.
 */
export function parseEnumField<T extends string>(
  raw: unknown,
  values: readonly T[],
  field: string,
): EnumFieldResult<T> {
  const choices = values.join(', ')
  if (typeof raw !== 'string') return { ok: false, message: `${field} must be one of: ${choices}.` }
  const normalized = raw.toLowerCase()
  // Both sides are lowercased, so the promise of case-insensitivity holds even
  // for a future member that is not itself all-lowercase.
  const match = values.find((candidate) => candidate.toLowerCase() === normalized)
  if (!match) return { ok: false, message: `Invalid ${field} '${raw}'. Use one of: ${choices}.` }
  return { ok: true, value: match }
}

/** The fields every sync request carries, whichever engine it drives. */
export type SyncRequestCore = {
  direction: SyncDirection
  dryRun: boolean
  /**
   * Sync sources whose files hold lines the parser cannot read, dropping those
   * lines. There is nobody to prompt over HTTP, so such sources fail by default;
   * this is the caller's explicit "yes", equivalent to the CLI's `--yes`.
   */
  ignoreUnreadableLines: boolean
  /**
   * Apply only one side of the diff, relative to the sync destination. Absent
   * (the CLI's missing `--only`) applies every change.
   */
  only?: SyncChangeFilter
}

/**
 * Validate the fields common to both sync requests. The caller has already
 * established that the body is an object, and validates its own name list (and
 * anything else it accepts) on top of this.
 */
export function parseSyncRequestCore(value: Record<string, unknown>): SyncRequestCore | string {
  const rawDirection = value.direction
  if (typeof rawDirection !== 'string' || rawDirection.length === 0) {
    return `direction is required (${SYNC_DIRECTIONS.join(' or ')})`
  }
  const direction = parseEnumField(rawDirection, SYNC_DIRECTIONS, 'direction')
  if (!direction.ok) return direction.message

  // The filter is optional, and an omitted one — including the empty string an
  // unset query param or form control produces — means "apply everything".
  let only: SyncChangeFilter | undefined
  if (value.only !== undefined && value.only !== null && value.only !== '') {
    const parsed = parseEnumField(value.only, SYNC_CHANGE_FILTERS, 'only')
    if (!parsed.ok) return parsed.message
    only = parsed.value
  }

  if (value.dryRun !== undefined && typeof value.dryRun !== 'boolean') {
    return 'dryRun must be a boolean'
  }
  if (
    value.ignoreUnreadableLines !== undefined &&
    typeof value.ignoreUnreadableLines !== 'boolean'
  ) {
    return 'ignoreUnreadableLines must be a boolean'
  }

  const core: SyncRequestCore = {
    direction: direction.value,
    dryRun: value.dryRun === true,
    ignoreUnreadableLines: value.ignoreUnreadableLines === true,
  }
  // Left off entirely when unfiltered, so the field is absent rather than null
  // wherever the request is echoed back or serialized.
  if (only) core.only = only
  return core
}

/** What an array of names does with an entry that is blank once trimmed. */
export type BlankNamePolicy = 'drop' | 'reject'

/** How {@link parseNameArray} reads one field, and what it calls it when refusing. */
export type NameArrayRules = {
  /** The field's name, as a refusal message spells it. */
  field: string
  /** What its entries are (`'deck names'`, `'collection list names'`). */
  noun: string
  /**
   * What a blank entry means. `'drop'` suits an unordered selection, where a
   * form control may well submit an empty row; `'reject'` suits an ordered one
   * — a removal priority — where quietly dropping an entry would change what
   * the array *means* rather than merely shortening it.
   */
  blanks: BlankNamePolicy
}

/**
 * Validate a request's list of names — decks to sync, collection lists to sync,
 * the lists an ambiguous removal may take copies from. Names are trimmed, and a
 * blank one is dropped or refused per {@link NameArrayRules.blanks}.
 *
 * Order is preserved either way: for a removal priority the order *is* the
 * meaning, and for the others it costs nothing to keep.
 */
export function parseNameArray(raw: unknown, rules: NameArrayRules): string[] | string {
  const values = raw ?? []
  if (!Array.isArray(values) || !values.every((name): name is string => typeof name === 'string')) {
    return `${rules.field} must be an array of ${rules.noun}`
  }
  const names = values.map((name) => name.trim())
  if (rules.blanks === 'drop') return names.filter((name) => name.length > 0)
  if (names.some((name) => name.length === 0)) return `${rules.field} must not contain blank names`
  return names
}

/**
 * The outcome of {@link parseOptionalText}. Structured rather than a
 * `string | undefined` union because the field's value and the message refusing
 * it are both strings — the caller must not have to guess which it was handed.
 */
export type OptionalTextResult =
  | { ok: true; value: string | undefined }
  | { ok: false; message: string }

/**
 * Validate an optional free-text field (the pull target's `into`). An absent,
 * null, or blank value means "unset" — the same thing an omitted query param and
 * an untouched form control mean — so it reads as `undefined` rather than being
 * refused; anything that is not a string is refused.
 */
export function parseOptionalText(raw: unknown, field: string, noun: string): OptionalTextResult {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'string') return { ok: false, message: `${field} must be ${noun}` }
  const trimmed = raw.trim()
  return { ok: true, value: trimmed === '' ? undefined : trimmed }
}

/**
 * The boolean-valued fields of a request — the ones a query string spells
 * 'true'/'false'.
 *
 * `NonNullable` rather than a bare `extends boolean`: an **optional** flag
 * (`csv?: boolean`) has the type `boolean | undefined`, which would not match and
 * would therefore be excused from {@link readBooleanFlags}'s completeness check —
 * silently reverting to `false` on every streamed run, which is precisely what
 * that check exists to prevent.
 */
export type BooleanFieldsOf<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends boolean ? K : never
}[keyof T]

/**
 * Read a request's boolean flags from a query string, refusing any value that is
 * not exactly `true` or `false`.
 *
 * `flags` lists every boolean field of the request type; declaring it as
 * `satisfies Record<BooleanFieldsOf<Request>, true>` makes leaving one out a
 * type error, which is what keeps a query string from silently reverting a flag
 * to `false`.
 */
export function readBooleanFlags<F extends string>(
  params: URLSearchParams,
  flags: Record<F, true>,
): Record<F, boolean> | string {
  const values = {} as Record<F, boolean>
  for (const flag of Object.keys(flags) as F[]) {
    const raw = params.get(flag)
    if (raw !== null && raw !== 'true' && raw !== 'false') {
      return `${flag} must be 'true' or 'false'`
    }
    values[flag] = raw === 'true'
  }
  return values
}
