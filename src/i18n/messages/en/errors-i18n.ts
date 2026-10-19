/**
 * `errors.i18n.*` — the translation machinery's own diagnostics: `t()`'s
 * strict-mode failures, the catalog-entry shape parser's refusals, the
 * locale-tag parser's refusals, and the browser's dictionary-load warning —
 * plus `errors.invariant.unhandled`, the `assertNever` sentence the describers'
 * exhaustive switches fall back on, so that fallback words itself too.
 *
 * Unlike every other fragment, this one is not registered by a surface entry
 * point: `src/i18n/runtime.ts` seeds the English catalog with it, so these
 * keys resolve in every process — a unit test that registered nothing, a
 * script, either SPA — and `t()` can word its own failure without depending on
 * the failure it is reporting.
 */

import type { MessageCatalogShape } from '../../types'

export const errorsI18nMessages = {
  // ── assertNever (src/util/assert-never.ts) ──────────────────────────
  'errors.invariant.unhandled':
    'Internal error: no case handles the value {value}. This is a bug in Ritual.',

  // ── t() under RITUAL_I18N_STRICT=1 ────────────────────────────────────
  'errors.i18n.strict.frame': 'i18n: {reason} (RITUAL_I18N_STRICT=1)',
  'errors.i18n.strict.missingKey': 'missing message key "{key}" — is its namespace registered?',
  'errors.i18n.strict.missingParam': 'message "{key}" is missing the "{param}" param',
  'errors.i18n.strict.notNumeric': 'message "{key}" needs a numeric "{param}" param',
  'errors.i18n.strict.noBranch': 'message "{key}" has no "{variant}" branch for "{selector}"',

  // ── Catalog entry shape (src/i18n/catalog.ts) ─────────────────────────
  'errors.i18n.entry.notAMessage': 'value must be a string, a $plural table, or a $select table',
  'errors.i18n.entry.pluralAndSelect': 'value cannot be both $plural and $select',
  'errors.i18n.entry.noDiscriminator': 'object value needs a $plural or $select discriminator',
  'errors.i18n.entry.branchNotString':
    'branch "{branch}" must be a string (nested plural-in-select is not supported — split the key)',
  'errors.i18n.entry.pluralWithoutOther': '$plural table needs an "other" form',
  'errors.i18n.entry.selectWithoutBranch': '$select table needs at least one branch',

  // ── Locale tags (src/i18n/locale-tag.ts) ──────────────────────────────
  'errors.i18n.localeTag.notAString':
    'locale must be a BCP-47 language tag string (e.g. "en", "de-AT")',
  'errors.i18n.localeTag.empty': 'locale must not be empty',
  'errors.i18n.localeTag.invalid': 'invalid locale tag: {value}',
  'errors.i18n.localeTag.literal':
    'Internal error: the locale literal {value} is not a locale tag ({reason}). This is a bug in Ritual.',

  // ── Browser dictionary delivery ───────────────────────────────────────
  'errors.i18n.dictionary.loadFailed':
    'Could not load the {locale} dictionary from {url}; using English.',
  'errors.i18n.dictionary.httpStatus': 'HTTP {status}',
} as const satisfies MessageCatalogShape
