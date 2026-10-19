/**
 * Wording a locale-tag refusal — the boundary where `locale-tag.ts`'s code
 * becomes a sentence — and {@link localeTag}, the one minting helper whose
 * failure needs that wording.
 *
 * `locale-tag.ts` sits under `t()` (the runtime parses the `__ritualLocale__`
 * seam with it), so it can neither word a refusal nor throw a worded error
 * without an import cycle. Its callers come here:
 *
 * - the `uiLocale` config value, `--locale` and `RITUAL_LOCALE` nest
 *   {@link localeTagErrorRef} as the `{reason}` of
 *   `domain.config.uiLocaleMalformed`, so a JSON refusal carries English plus
 *   the key tree and a translated one has no English glued in;
 * - `build-site --locale-file` and the locale scripts print
 *   {@link describeLocaleTagError} in their own language.
 *
 * The keys live in the `errors.i18n.*` fragment the runtime seeds, so they
 * resolve on every surface that renders a nested config refusal.
 *
 * Browser-safe: no `node:` imports.
 */

import type { SyncMessageRef } from '../sync/message'
import { assertNever } from '../util/assert-never'
import { isLocaleTagError, parseLocaleTag, type LocaleTagError } from './locale-tag'
import { currentLocale } from './runtime'
import { tDiagnosticIn } from './t'
import type { LocaleTag } from './types'

/**
 * A locale-tag refusal as a message, for nesting as another message's param.
 * Built as a plain object (the `SyncMessageRef` shape, imported as a type
 * only) so the translation stack takes on no value dependency on the sync
 * layer.
 */
export function localeTagErrorRef(error: LocaleTagError): SyncMessageRef {
  switch (error.problem) {
    case 'notAString':
      return { messageKey: 'errors.i18n.localeTag.notAString' }
    case 'empty':
      return { messageKey: 'errors.i18n.localeTag.empty' }
    case 'invalid':
      return { messageKey: 'errors.i18n.localeTag.invalid', messageParams: { value: error.value } }
    default:
      return assertNever(error)
  }
}

/**
 * A locale-tag refusal worded in `locale` — with strict checks off, like every
 * diagnostic of the translation machinery (see `tDiagnosticIn`).
 */
export function describeLocaleTagError(
  error: LocaleTagError,
  locale: LocaleTag = currentLocale(),
): string {
  switch (error.problem) {
    case 'notAString':
      return tDiagnosticIn(locale, 'errors.i18n.localeTag.notAString')
    case 'empty':
      return tDiagnosticIn(locale, 'errors.i18n.localeTag.empty')
    case 'invalid':
      return tDiagnosticIn(locale, 'errors.i18n.localeTag.invalid', { value: error.value })
    default:
      return assertNever(error)
  }
}

/**
 * Mint a {@link LocaleTag} from a literal the caller knows is well-formed, and
 * throw if it is not.
 *
 * For compile-time constants and test fixtures — `localeTag('de-DE')` — where
 * threading a parse result through would only add noise. Anything that came from
 * a user, a file, a query string, or a wire must use `parseLocaleTag` and
 * handle the error branch instead.
 *
 * A malformed literal is a bug in the program, not a user mistake, so the throw
 * is an internal-error sentence naming the literal and why it failed.
 */
export function localeTag(value: string): LocaleTag {
  const parsed = parseLocaleTag(value)
  if (isLocaleTagError(parsed)) {
    const locale = currentLocale()
    throw new Error(
      tDiagnosticIn(locale, 'errors.i18n.localeTag.literal', {
        value: JSON.stringify(value),
        reason: describeLocaleTagError(parsed, locale),
      }),
    )
  }
  return parsed
}
