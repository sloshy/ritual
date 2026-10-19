/**
 * Parsing and comparison for BCP-47 UI locale tags.
 *
 * Every `Intl.*` constructor in Ritual receives an explicit tag (Bun resolves
 * no locale from the environment — see `detect.ts`), so a tag has to be
 * validated exactly once, at the edge: `--locale`, `RITUAL_LOCALE`, the
 * `uiLocale` config key, a `?locale=` query, and OS detection all funnel
 * through {@link parseLocaleTag}.
 *
 * This module is browser-safe (no `node:` imports).
 */

import type { LocaleTag } from './types'

/**
 * The error branch of {@link parseLocaleTag}: why the value is not a locale
 * tag, as a code. This module sits under `t()` (the runtime parses the
 * `__ritualLocale__` seam with it), so it cannot word anything itself; the code
 * is worded where it is shown — `localeTagErrorRef` / `describeLocaleTagError`
 * in `locale-tag-message.ts`, keyed `errors.i18n.localeTag.*`.
 */
export type LocaleTagError =
  /** Not a string at all (a number or a list in a config file). */
  | { problem: 'notAString' }
  /** Blank once trimmed. */
  | { problem: 'empty' }
  /** A string `Intl.Locale` refuses; `value` is it, trimmed. */
  | { problem: 'invalid'; value: string }

/** Narrow a {@link parseLocaleTag} result to its error branch. */
export function isLocaleTagError(result: LocaleTag | LocaleTagError): result is LocaleTagError {
  return typeof result === 'object' && result !== null && typeof result.problem === 'string'
}

/**
 * Validate and canonicalize a BCP-47 tag. Structural validity is decided by
 * `new Intl.Locale()` — the same engine that will later be handed the tag —
 * and the canonical form is returned (`de_de` is not accepted, but `de-de`
 * canonicalizes to `de-DE`) so cache keys and comparisons agree.
 */
export function parseLocaleTag(value: unknown): LocaleTag | LocaleTagError {
  if (typeof value !== 'string') {
    return { problem: 'notAString' }
  }
  const trimmed = value.trim()
  if (trimmed === '') return { problem: 'empty' }
  try {
    // The one minting site for the branded `LocaleTag` (see `types.ts`): every
    // tag in the project is canonical because it came through here.
    return new Intl.Locale(trimmed).toString() as LocaleTag
  } catch {
    return { problem: 'invalid', value: trimmed }
  }
}

/**
 * Whether the value parses as a BCP-47 tag.
 *
 * Deliberately **not** a type predicate: a well-formed tag is not necessarily a
 * canonical one (`de-de` passes), and narrowing the input would hand the raw,
 * uncanonicalized string the {@link LocaleTag} brand — the exact bug branding
 * exists to prevent. Use {@link parseLocaleTag} and keep its result whenever you
 * need the tag itself; this is only for "is this shaped like a locale".
 */
export function isLocaleTag(value: unknown): boolean {
  return !isLocaleTagError(parseLocaleTag(value))
}

/**
 * The primary language subtag of a tag (`de-AT` → `de`), lowercased, or the
 * lowercased tag itself when it cannot be parsed. Used by locale negotiation to
 * fall from a regional tag back to its language.
 */
export function localeLanguage(tag: string): string {
  try {
    return new Intl.Locale(tag).language.toLowerCase()
  } catch {
    const [language = ''] = tag.toLowerCase().split('-')
    return language
  }
}
