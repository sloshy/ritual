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

/** The error branch of {@link parseLocaleTag}: why the value is not a locale tag. */
export type LocaleTagError = { error: string }

/** Narrow a {@link parseLocaleTag} result to its error branch. */
export function isLocaleTagError(result: LocaleTag | LocaleTagError): result is LocaleTagError {
  return typeof result === 'object' && result !== null && typeof result.error === 'string'
}

/**
 * Validate and canonicalize a BCP-47 tag. Structural validity is decided by
 * `new Intl.Locale()` — the same engine that will later be handed the tag —
 * and the canonical form is returned (`de_de` is not accepted, but `de-de`
 * canonicalizes to `de-DE`) so cache keys and comparisons agree.
 */
export function parseLocaleTag(value: unknown): LocaleTag | LocaleTagError {
  if (typeof value !== 'string') {
    return { error: 'locale must be a BCP-47 language tag string (e.g. "en", "de-AT")' }
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return { error: 'locale must not be empty' }
  }
  try {
    // The one minting site for the branded `LocaleTag` (see `types.ts`): every
    // tag in the project is canonical because it came through here.
    return new Intl.Locale(trimmed).toString() as LocaleTag
  } catch {
    return { error: `invalid locale tag: ${trimmed}` }
  }
}

/**
 * Mint a {@link LocaleTag} from a literal the caller knows is well-formed, and
 * throw if it is not.
 *
 * For compile-time constants and test fixtures — `localeTag('de-DE')` — where
 * threading a parse result through would only add noise. Anything that came from
 * a user, a file, a query string, or a wire must use {@link parseLocaleTag} and
 * handle the error branch instead.
 */
export function localeTag(value: string): LocaleTag {
  const parsed = parseLocaleTag(value)
  if (isLocaleTagError(parsed)) throw new Error(parsed.error)
  return parsed
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
