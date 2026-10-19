/** Translator metadata for the `errors.i18n.*` fragment. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { errorsI18nMessages } from './errors-i18n'

/** Shared context for the strict-mode diagnostics. */
const STRICT =
  'A developer diagnostic, raised only when the test harness runs with strict translation checks on (never in a user’s shell): a message could not be rendered.'

/** Shared context for the catalog-entry refusals. */
const ENTRY =
  'Why one entry of a translation file is not a usable message. Shown by the translation checker and by `ritual build-site --locale-file`, after the entry’s key. "$plural", "$select" and "other" are literal file syntax — keep them exactly.'

/** Shared context for the locale-tag refusals. */
const LOCALE_TAG =
  'Why a value is not a language tag (a BCP-47 tag such as "en" or "de-AT"). Shown nested inside a refusal of the interface-language setting, the --locale flag or the RITUAL_LOCALE variable, or of a --locale-file name.'

export const errorsI18nMeta = {
  'errors.invariant.unhandled': {
    description:
      'An internal consistency failure: an exhaustive switch met a value none of its cases handles (a programming error, not a user mistake). {value} is that value as raw data — a quoted token, an object’s kind, or JSON, capped at 200 characters — and is never translated.',
  },
  'errors.i18n.strict.frame': {
    description: `${STRICT} The outer frame: {reason} is one of the other strict-mode diagnostics, already worded. "i18n" and "RITUAL_I18N_STRICT=1" are literal — keep them exactly.`,
  },
  'errors.i18n.strict.missingKey': {
    description: `${STRICT} The message key {key} exists in no loaded catalog. A "namespace" is the key’s first segment (e.g. "cli"), which each program registers separately.`,
  },
  'errors.i18n.strict.missingParam': {
    description: `${STRICT} The message {key} has a placeholder named {param} that the caller supplied no value for.`,
  },
  'errors.i18n.strict.notNumeric': {
    description: `${STRICT} The count-dependent message {key} was given no number in its count parameter {param}.`,
  },
  'errors.i18n.strict.noBranch': {
    description: `${STRICT} The variant-dependent message {key} has no wording for the value {variant} of its selector parameter {selector}, and no catch-all.`,
  },
  'errors.i18n.entry.notAMessage': {
    description: `${ENTRY} The entry is neither text nor one of the two table forms.`,
  },
  'errors.i18n.entry.pluralAndSelect': {
    description: `${ENTRY} The entry declares both table kinds at once.`,
  },
  'errors.i18n.entry.noDiscriminator': {
    description: `${ENTRY} The entry is an object but names neither table kind.`,
  },
  'errors.i18n.entry.branchNotString': {
    description: `${ENTRY} One form of the table, named {branch}, is not text — usually a table nested inside another, which the format does not allow.`,
  },
  'errors.i18n.entry.pluralWithoutOther': {
    description: `${ENTRY} A count-dependent table lacks its mandatory catch-all form.`,
  },
  'errors.i18n.entry.selectWithoutBranch': {
    description: `${ENTRY} A variant table lists no forms at all.`,
  },
  'errors.i18n.localeTag.notAString': {
    description: `${LOCALE_TAG} The value is not text at all (in a configuration file, a number or a list). "BCP-47" is the standard’s name; "en" and "de-AT" are example tags — keep all three exactly.`,
  },
  'errors.i18n.localeTag.empty': {
    description: `${LOCALE_TAG} The value is blank.`,
  },
  'errors.i18n.localeTag.invalid': {
    description: `${LOCALE_TAG} {value} is the value as given, which is not shaped like a tag.`,
  },
  'errors.i18n.localeTag.literal': {
    description:
      'An internal consistency failure (a programming error, not a user mistake): a language tag written into the program itself is malformed. {value} is that tag, quoted; {reason} is why, already worded.',
  },
  'errors.i18n.dictionary.loadFailed': {
    description:
      'Printed to the browser’s developer console when the site could not download the translation file for a language, so the page stays in English. {locale} is the language tag, {url} the file’s address; the underlying error follows on the same line.',
  },
  'errors.i18n.dictionary.httpStatus': {
    description:
      'The reason a translation file could not be downloaded: the web server answered with the HTTP status code {status} (e.g. 404). "HTTP" is literal.',
  },
} as const satisfies MetaFor<typeof errorsI18nMessages>
