/**
 * Locale negotiation: pick the best available locale for a prioritized list of
 * requested ones. Used identically by CLI detection (the `LANGUAGE` colon list,
 * or a single detected tag) and by the browser against `navigator.languages`.
 *
 * `Intl.LocaleMatcher` is a stage-1 proposal, not a shipped API, so the match
 * is done here: exact tag, then language subtag, then English.
 *
 * Per-key fallback is a separate layer — `t()` walks locale → English → key —
 * so a partially translated locale renders English for its gaps rather than
 * raw keys, and negotiation never has to reason about coverage.
 *
 * Browser-safe: no `node:` imports.
 */

import { DEFAULT_LOCALE } from './constants'
import { localeLanguage } from './locale-tag'
import type { LocaleTag } from './types'

/**
 * The best match for `requested` among `available`, or `undefined` when nothing
 * matches. Requested tags are tried in priority order, and each is resolved
 * fully — exact tag (case-insensitively), then language subtag — before the
 * next is considered. Request order therefore outranks match quality:
 * `['de-AT', 'fr']` against `['fr', 'de']` picks `de`, honoring the user's first
 * preference rather than the exact match for a lower-priority one.
 *
 * "Nothing matched" is reported as `undefined` rather than English, because
 * both callers need to tell it apart from a genuine English match: the browser
 * must fall through to the site's configured default, and `ritual locale` must
 * report `source: 'default'` rather than crediting the tier that asked.
 * {@link negotiateLocale} is the terminating form for anyone who does not care.
 */
export function matchLocale(
  requested: readonly string[],
  available: readonly LocaleTag[],
): LocaleTag | undefined {
  for (const want of requested) {
    const trimmed = want.trim()
    if (trimmed === '') continue
    const exact = available.find((tag) => tag.toLowerCase() === trimmed.toLowerCase())
    if (exact !== undefined) return exact
    const language = localeLanguage(trimmed)
    const byLanguage = available.find((tag) => localeLanguage(tag) === language)
    if (byLanguage !== undefined) return byLanguage
  }
  return undefined
}

/** {@link matchLocale}, terminating at {@link DEFAULT_LOCALE} when nothing matches. */
export function negotiateLocale(
  requested: readonly string[],
  available: readonly LocaleTag[],
): LocaleTag {
  return matchLocale(requested, available) ?? DEFAULT_LOCALE
}
