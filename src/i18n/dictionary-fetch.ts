/**
 * The browser's dictionary delivery: fetch `locales/<tag>.json` same-origin,
 * once, and register it with the runtime.
 *
 * Its own module rather than part of `runtime.ts` because a failed fetch is
 * worded through `t()`, and `t.ts` imports the runtime — keeping the fetch here
 * keeps that edge one-way.
 *
 * Browser-safe: no `node:` imports.
 */

import { isAbortError } from '../util/errors'
import { coerceCatalog } from './catalog'
import {
  currentLocale,
  DEFAULT_LOCALE,
  getDictionary,
  loadDictionary,
  localeFileName,
  LOCALES_DIR,
} from './runtime'
import { tDiagnosticIn } from './t'
import type { LocaleTag } from './types'

/** Options for {@link ensureLocaleLoaded}. */
export type DictionaryFetchOptions = {
  /**
   * Prefix for the dictionary URL, for a site not served from the origin root.
   * Defaults to the relative `locales/<tag>.json` the shell and the build agree
   * on — same-origin, so no CSP change is needed under `default-src 'self'`.
   */
  basePath?: string
  signal?: AbortSignal
}

/**
 * Make sure a locale's dictionary is loaded, fetching it once if it is not.
 *
 * English is inline in the bundle and never fetched, so the default path is
 * never a waterfall and the UI is never blank. A locale whose dictionary cannot
 * be fetched degrades to English rather than failing the boot: a missing
 * translation is a cosmetic problem and refusing to render the site over one
 * would be worse than the gap.
 *
 * The failure is a console warning in the UI language in force — still the
 * previous one, or English at boot — with the HTTP status or the underlying
 * error after it.
 *
 * Returns the locale that is actually renderable, which callers should apply
 * rather than the one they asked for.
 */
export async function ensureLocaleLoaded(
  tag: LocaleTag,
  options: DictionaryFetchOptions = {},
): Promise<LocaleTag> {
  if (tag === DEFAULT_LOCALE) return DEFAULT_LOCALE
  if (getDictionary(tag) !== undefined) return tag
  const base = options.basePath ?? ''
  const url = `${base}${LOCALES_DIR}/${encodeURIComponent(localeFileName(tag))}`
  const warn = (cause: unknown): LocaleTag => {
    const uiLocale = currentLocale()
    console.warn(
      tDiagnosticIn(uiLocale, 'errors.i18n.dictionary.loadFailed', { locale: tag, url }),
      cause,
    )
    return DEFAULT_LOCALE
  }
  try {
    const response = await fetch(url, options.signal ? { signal: options.signal } : undefined)
    if (!response.ok) {
      return warn(
        tDiagnosticIn(currentLocale(), 'errors.i18n.dictionary.httpStatus', {
          status: response.status,
        }),
      )
    }
    loadDictionary(tag, coerceCatalog(await response.json()))
    return tag
  } catch (error) {
    if (isAbortError(error)) return DEFAULT_LOCALE
    return warn(error)
  }
}

/**
 * Apply a locale whose dictionary has been made renderable — set the runtime,
 * the document and whatever signal mirrors it. Supplied by each SPA.
 */
export type ApplyLocale = (usable: LocaleTag) => void

/**
 * Load a locale's dictionary, then apply it — unless a later call has started
 * since, or `signal` was aborted while the fetch was in flight. Resolves with
 * the locale applied (English when the dictionary could not be fetched), or
 * `undefined` when the call was superseded or cancelled and applied nothing.
 */
export type LocaleApplier = (tag: LocaleTag, signal?: AbortSignal) => Promise<LocaleTag | undefined>

/**
 * A latest-wins {@link LocaleApplier} around `apply`.
 *
 * Two switches in quick succession (or the boot's resolution racing a switch)
 * each await a fetch, and fetches settle in any order: without a guard, a slow
 * dictionary for the language the reader picked *first* lands last and
 * overrules the one they picked second. Each call takes a monotonic token and
 * applies only if it is still the newest when its fetch settles; an aborted
 * call (a disposed boot) applies nothing either, so it cannot stamp English
 * over the page after the fact.
 */
export function createLocaleApplier(apply: ApplyLocale): LocaleApplier {
  let latest = 0
  return async (tag, signal) => {
    const token = ++latest
    const usable = await ensureLocaleLoaded(tag, signal ? { signal } : undefined)
    if (token !== latest || signal?.aborted === true) return undefined
    apply(usable)
    return usable
  }
}
