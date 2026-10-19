/**
 * Wording a catalog-entry refusal — the boundary where the shape parser's code
 * (`catalog.ts`) becomes a sentence.
 *
 * `catalog.ts` stays free of `t()` so the browser's dictionary coercion and the
 * locale scripts can use it without the rendering stack, so it returns a code;
 * its two reporting callers — `build-site --locale-file`
 * (`src/site-build/locales.ts`) and `scripts/check-locales.ts` — word it here.
 * The keys live in the `errors.i18n.*` fragment the runtime seeds, so they
 * resolve in a script that registered nothing.
 *
 * Browser-safe: no `node:` imports.
 */

import { assertNever } from '../util/assert-never'
import type { CatalogEntryError } from './catalog'
import { currentLocale } from './runtime'
import { tDiagnosticIn } from './t'
import type { LocaleTag } from './types'

/**
 * Why a translation-file entry is not a message, in `locale` — with strict
 * checks off, like every diagnostic of the translation machinery (see
 * `tDiagnosticIn`).
 */
export function describeCatalogEntryError(
  error: CatalogEntryError,
  locale: LocaleTag = currentLocale(),
): string {
  switch (error.problem) {
    case 'notAMessage':
      return tDiagnosticIn(locale, 'errors.i18n.entry.notAMessage')
    case 'pluralAndSelect':
      return tDiagnosticIn(locale, 'errors.i18n.entry.pluralAndSelect')
    case 'noDiscriminator':
      return tDiagnosticIn(locale, 'errors.i18n.entry.noDiscriminator')
    case 'branchNotString':
      return tDiagnosticIn(locale, 'errors.i18n.entry.branchNotString', { branch: error.branch })
    case 'pluralWithoutOther':
      return tDiagnosticIn(locale, 'errors.i18n.entry.pluralWithoutOther')
    case 'selectWithoutBranch':
      return tDiagnosticIn(locale, 'errors.i18n.entry.selectWithoutBranch')
    default:
      return assertNever(error)
  }
}
