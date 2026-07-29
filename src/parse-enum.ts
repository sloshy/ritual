/**
 * Enum parsing shared by every surface — CLI flags, HTTP bodies, and query
 * strings. Layer-neutral on purpose, beside {@link module:parse-number}: the
 * acceptance rule for "one of these strings" must be identical wherever it is
 * asked for, so `--format CSV` and `{"format":"CSV"}` mean the same thing.
 *
 * Each caller keeps its own error *channel* (commander throws, handlers return
 * a 400 body) while sharing the wording produced here.
 */

/** The outcome of {@link parseEnumField}: the canonical member, or why it was refused. */
export type EnumFieldResult<T extends string> =
  | { ok: true; value: T }
  | { ok: false; message: string }

/**
 * Match a value against a string enum case-insensitively, as the CLI's
 * `parseEnumFlag` does, so the same spelling is accepted whichever surface it is
 * typed into. The canonical member is returned, never the caller's casing.
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
