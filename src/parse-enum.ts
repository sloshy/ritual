/**
 * Enum parsing shared by every surface — CLI flags, HTTP bodies, and query
 * strings. Layer-neutral on purpose, beside {@link module:parse-number}: the
 * acceptance rule for "one of these strings" must be identical wherever it is
 * asked for, so `--format CSV` and `{"format":"CSV"}` mean the same thing.
 *
 * Each caller keeps its own error *channel* (commander throws, handlers return
 * a 400 body) while sharing the wording produced here.
 *
 * One of the single-function multipliers: two messages here cover every
 * fixed-choice option in the project, so this is one edit rather than dozens.
 * `field` and `choices` are English identifiers spliced into the sentence and
 * are never themselves translated.
 */

import { t, type MessageParams, type RenderParams } from './i18n/t'
import type { MessageKey } from './i18n/messages/en'

/** The outcome of {@link parseEnumField}: the canonical member, or why it was refused. */
export type EnumFieldResult<T extends string> =
  | { ok: true; value: T }
  | {
      ok: false
      message: string
      /** The catalog key `message` was rendered from — locale-invariant. */
      messageKey: MessageKey
      /**
       * What that key interpolates. Both of this module's messages take
       * parameters, so a client handed the key alone would re-render literal
       * `{field}` / `{value}` / `{choices}` tokens.
       */
      messageParams: RenderParams
    }

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
  if (typeof raw !== 'string') {
    const params: MessageParams<'errors.enum.type'> = { field, choices }
    return {
      ok: false,
      message: t('errors.enum.type', params),
      messageKey: 'errors.enum.type',
      messageParams: params,
    }
  }
  const normalized = raw.toLowerCase()
  // Both sides are lowercased, so the promise of case-insensitivity holds even
  // for a future member that is not itself all-lowercase.
  const match = values.find((candidate) => candidate.toLowerCase() === normalized)
  if (!match) {
    const params: MessageParams<'errors.enum.invalid'> = { field, value: raw, choices }
    return {
      ok: false,
      message: t('errors.enum.invalid', params),
      messageKey: 'errors.enum.invalid',
      messageParams: params,
    }
  }
  return { ok: true, value: match }
}
