/**
 * Module state for the active UI locale and the dictionaries loaded for it.
 *
 * The effective locale resolves in precedence order:
 *
 * 1. The `__ritualLocale__` global — the end-to-end test seam, injected by
 *    Playwright's `addInitScript` before the app boots. Always wins so a
 *    configured or negotiated value can never leak into an assertion.
 * 2. The locale applied at boot via {@link setLocale} — resolved by the CLI
 *    from `--locale` / `RITUAL_LOCALE` / `uiLocale` / OS detection, and by the
 *    SPAs from the hash query, localStorage, `navigator.languages` and the
 *    baked default.
 * 3. {@link DEFAULT_LOCALE} (`en`).
 *
 * This is a verbatim copy of the three-tier seam in
 * `src/editor/search-debounce.ts` and `src/editor/default-language.ts`.
 *
 * Browser-safe: no `node:` imports, no filesystem, no `Intl` construction.
 * Dictionaries arrive from whoever loaded them — the CLI hands over the
 * generated locale module (`src/commands/locale.ts`), and the browser fetches
 * `locales/<tag>.json` same-origin through {@link ensureLocaleLoaded} below.
 *
 * **English arrives the same way.** This module does not import the English
 * catalog; each surface entry point registers the namespaces it actually speaks
 * (`src/i18n/register/{cli,site,admin}.ts`). That is what makes the §4.2
 * namespace boundary a real import boundary rather than an authoring
 * convention — without it, `t()`'s English fallback would pull all seven
 * namespaces into both SPA bundles.
 */

import { coerceCatalog } from './catalog'
import { DEFAULT_LOCALE } from './constants'
import { isLocaleTagError, parseLocaleTag } from './locale-tag'
import { matchLocale } from './negotiate'
import type { LocaleCatalog, LocaleTag, MessageCatalogShape, MessageValue } from './types'

export { coerceCatalog } from './catalog'
// Re-exported so the ~15 existing `from '../i18n/runtime'` import sites keep
// working; the constant itself lives in the leaf module that broke the
// runtime ↔ negotiate cycle.
export { DEFAULT_LOCALE } from './constants'

/**
 * Test-seam override for the UI locale, set on the global object. Shared with
 * the e2e helper that injects it.
 */
export type LocaleOverride = { __ritualLocale__?: string }

/** The locale applied for this app instance; null until boot resolves one. */
let appliedLocale: LocaleTag | null = null

/**
 * A reactive accessor mirroring {@link appliedLocale}, installed by the Solid
 * layer at boot (`createI18nStore` in `src/ui/i18n.tsx`).
 *
 * Module state is invisible to Solid, so every module-level renderer that reads
 * the locale ambiently — `formatDateTime`, `formatPrice`, `compareDisplay`,
 * `changeSegments`, `cardLabelName` — would freeze its output in the boot
 * language while the `t()` calls around it re-rendered. Rather than thread a
 * translator through each of them, {@link currentLocale} reads *through* this
 * accessor: inside a Solid tracking scope that subscribes the caller, and
 * everywhere else (the CLI, the build, an event handler) it is a plain read.
 *
 * `null` in every non-Solid consumer, which is why the CLI pays nothing for it.
 */
let localeSource: (() => LocaleTag) | null = null

/**
 * Install (or, with `null`, remove) the reactive locale accessor described on
 * {@link localeSource}. Called once per app boot; the accessor must report the
 * same value {@link setLocale} was last given.
 */
export function registerLocaleSource(source: (() => LocaleTag) | null): void {
  localeSource = source
}

/**
 * The English catalog this process speaks, assembled by {@link registerMessages}
 * from whichever namespaces the surface entry point registered.
 *
 * Mutated in place rather than replaced, so the entry in {@link dictionaries}
 * (and anything else holding the reference) always sees the current set.
 */
const english: LocaleCatalog = {}

/** Dictionaries loaded so far, keyed by locale tag. English is always present. */
const dictionaries = new Map<LocaleTag, LocaleCatalog>([[DEFAULT_LOCALE, english]])

/**
 * Add message namespaces to this process's English catalog. Called once per
 * surface at boot, from `src/i18n/register/{cli,site,admin}.ts`.
 *
 * Registering is additive and idempotent — a fragment registered twice simply
 * overwrites itself with the same values — so an entry point that registers
 * defensively costs nothing.
 */
export function registerMessages(...fragments: readonly MessageCatalogShape[]): void {
  for (const fragment of fragments) Object.assign(english, fragment)
}

/**
 * The English message for a key, or `undefined` when its namespace was never
 * registered. `t()`'s last fallback before the key string itself.
 */
export function englishMessage(key: string): MessageValue | undefined {
  return english[key]
}

/** Whether a key exists in this process's registered English catalog. */
export function hasEnglishMessage(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(english, key)
}

/** How many English messages are registered. For diagnostics and tests. */
export function registeredMessageCount(): number {
  return Object.keys(english).length
}

/**
 * Apply the resolved UI locale. Called once at boot, and again whenever the
 * user switches language in an SPA.
 */
export function setLocale(tag: LocaleTag): void {
  appliedLocale = tag
}

/** Clear the applied locale, falling back to {@link DEFAULT_LOCALE}. For tests and boot. */
export function resetLocale(): void {
  appliedLocale = null
}

/**
 * The effective UI locale from module state alone, ignoring any registered
 * reactive source. This is what {@link registerLocaleSource}'s accessor is
 * expected to mirror, so the Solid store seeds and re-seeds its signal from here
 * rather than from {@link currentLocale} (which would read its own signal back).
 */
export function appliedLocaleTag(): LocaleTag {
  const override = (globalThis as unknown as LocaleOverride).__ritualLocale__
  if (typeof override === 'string') {
    const parsed = parseLocaleTag(override)
    if (!isLocaleTagError(parsed)) return parsed
  }
  return appliedLocale ?? DEFAULT_LOCALE
}

/**
 * Resolve the effective UI locale (see module doc for precedence).
 *
 * Reads through the registered reactive source when there is one, so a call
 * inside a Solid tracking scope subscribes to language changes — see
 * {@link registerLocaleSource}.
 */
export function currentLocale(): LocaleTag {
  return localeSource?.() ?? appliedLocaleTag()
}

/**
 * Register a dictionary for a locale. Translations are *not* merged over
 * English here — `t()` walks locale → English → key per call, so a partially
 * translated locale stays shippable and a later, fuller dictionary can replace
 * this one wholesale.
 */
export function loadDictionary(tag: LocaleTag, catalog: LocaleCatalog): void {
  if (tag === DEFAULT_LOCALE) return
  dictionaries.set(tag, catalog)
}

/** The dictionary registered for a locale, or `undefined` when none is loaded. */
export function getDictionary(tag: LocaleTag): LocaleCatalog | undefined {
  return dictionaries.get(tag)
}

/** Every locale a dictionary is loaded for, English first. */
export function loadedLocales(): LocaleTag[] {
  return [...dictionaries.keys()]
}

/** Drop every loaded dictionary except English, and clear the applied locale. For tests. */
export function resetI18nRuntime(): void {
  resetLocale()
  registerLocaleSource(null)
  for (const tag of dictionaries.keys()) {
    if (tag !== DEFAULT_LOCALE) dictionaries.delete(tag)
  }
}

// ---------------------------------------------------------------------------
// Browser delivery
// ---------------------------------------------------------------------------

/**
 * Where both SPAs remember the language the user picked. Read by the shell's
 * `boot.js` before first paint and by {@link resolveBrowserLocale} at boot.
 */
export const LOCALE_STORAGE_KEY = 'ritual:locale'

/** The directory the built site publishes its dictionaries into. */
export const LOCALES_DIR = 'locales'

/**
 * Every tier of the browser's locale precedence, gathered by the caller so this
 * stays pure and testable. Order of the fields is the order of precedence.
 */
export type BrowserLocaleInput = {
  /** The `__ritualLocale__` global — the e2e seam. Always wins when set. */
  override?: string | undefined
  /** `?locale=` from the hash query. Public site only; the admin has no hash query. */
  query?: string | undefined
  /** The value stored under {@link LOCALE_STORAGE_KEY}. */
  stored?: string | undefined
  /** `navigator.languages`, in the browser's own priority order. */
  preferred?: readonly string[]
  /** The deployment's default: `SiteIndex.uiLocale`, or `uiLocale` from `GET /api/config`. */
  configured?: string | undefined
  /** The locales this deployment ships dictionaries for, English first. */
  available: readonly LocaleTag[]
}

/**
 * Resolve the UI locale for a browser.
 *
 * The explicit tiers (`__ritualLocale__`, `?locale=`, localStorage, the
 * configured default) are honored verbatim when they are well-formed tags —
 * per-key English fallback covers a partial catalog, so an explicit choice is
 * never second-guessed. Only `navigator.languages` is *negotiated* against the
 * available set, because a browser preference list is a statement about the
 * user, not about this deployment: matching `de-AT` to a shipped `de` is the
 * whole point, and matching nothing means the browser told us nothing usable.
 *
 * Every tier returns the *parsed* tag, never the raw user string: `?locale=de-de`
 * resolves to `de-DE`, which is the form the dictionary map is keyed by and the
 * form `locales/<tag>.json` is published under.
 */
export function resolveBrowserLocale(input: BrowserLocaleInput): LocaleTag {
  for (const candidate of [input.override, input.query, input.stored]) {
    const parsed = parseLocaleTag(candidate)
    if (!isLocaleTagError(parsed)) return parsed
  }
  const preferred = (input.preferred ?? []).filter((tag) => tag.trim() !== '')
  if (preferred.length > 0) {
    // `matchLocale` reports "nothing matched" as `undefined`, so a browser that
    // genuinely asked for English is distinguishable from one whose whole
    // preference list this deployment ships nothing for — the latter must fall
    // through to the site's own configured default.
    const matched = matchLocale(preferred, input.available)
    if (matched !== undefined) return matched
  }
  const configured = parseLocaleTag(input.configured)
  if (!isLocaleTagError(configured)) return configured
  return DEFAULT_LOCALE
}

/** The stored locale, or undefined when there is none (or no storage at all). */
export function readStoredLocale(): string | undefined {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Remember (or forget, with `null`) the user's chosen locale, so the shell's
 * `boot.js` can stamp `lang`/`dir` before the next first paint.
 */
export function writeStoredLocale(tag: LocaleTag | null): void {
  try {
    if (tag === null) localStorage.removeItem(LOCALE_STORAGE_KEY)
    else localStorage.setItem(LOCALE_STORAGE_KEY, tag)
  } catch {
    // Private-mode storage refusals are not worth failing a language switch over.
  }
}

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
 * Returns the locale that is actually renderable, which callers should apply
 * rather than the one they asked for.
 */
export async function ensureLocaleLoaded(
  tag: LocaleTag,
  options: DictionaryFetchOptions = {},
): Promise<LocaleTag> {
  if (tag === DEFAULT_LOCALE) return DEFAULT_LOCALE
  if (dictionaries.has(tag)) return tag
  const base = options.basePath ?? ''
  const url = `${base}${LOCALES_DIR}/${encodeURIComponent(tag)}.json`
  try {
    const response = await fetch(url, options.signal ? { signal: options.signal } : undefined)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const catalog = coerceCatalog(await response.json())
    loadDictionary(tag, catalog)
    return tag
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return DEFAULT_LOCALE
    console.warn(`Could not load the ${tag} dictionary from ${url}; using English.`, error)
    return DEFAULT_LOCALE
  }
}

/**
 * Whether missing keys and missing parameters must throw instead of degrading.
 * Set by CI and by the pseudo-locale test project so gaps are loud exactly
 * where they should be; never set in a user's shell, where `t()` must never
 * throw.
 *
 * Read on every call rather than memoized so a test can flip it mid-suite. The
 * `process` guard keeps this browser-safe.
 */
export function isStrictI18n(): boolean {
  if (typeof process === 'undefined') return false
  return process.env?.RITUAL_I18N_STRICT === '1'
}
