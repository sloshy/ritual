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
 * generated locale module (`src/cli/locale.ts`), and the browser fetches
 * `locales/<tag>.json` same-origin through `ensureLocaleLoaded`
 * (`dictionary-fetch.ts`, kept out of this module because its warning is worded
 * through `t()`, which imports this one).
 *
 * **English arrives the same way.** This module does not import the English
 * catalog (only the small `errors.i18n.*` fragment its own diagnostics need —
 * see {@link english}); each surface entry point registers the namespaces it actually speaks
 * (`src/i18n/register/{cli,site,admin}.ts`). That is what makes the
 * namespace boundary a real import boundary rather than an authoring
 * convention — without it, `t()`'s English fallback would pull all seven
 * namespaces into both SPA bundles.
 */

import { DEFAULT_LOCALE } from './constants'
import { isLocaleTagError, parseLocaleTag, type LocaleTagError } from './locale-tag'
import { errorsI18nMessages } from './messages/en/errors-i18n'
import { matchLocale } from './negotiate'
import type { LocaleCatalog, LocaleTag, MessageCatalogShape, MessageValue } from './types'

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
 * Told whenever a dictionary is registered. The Solid store installs one so a
 * dictionary that arrives *after* the first render re-renders the text already
 * on screen: the applied tag may not change at all (the `__ritualLocale__` seam
 * names it before its dictionary is fetched), so a locale signal alone would
 * never fire. `null` everywhere else.
 *
 * It is told nothing about *which* dictionary arrived, on purpose: the listener
 * re-reads the runtime's applied state, so a fetch a later switch superseded
 * can never push its own tag onto the screen.
 */
let dictionaryListener: (() => void) | null = null

/** Install (or, with `null`, remove) the {@link dictionaryListener}. */
export function registerDictionaryListener(listener: (() => void) | null): void {
  dictionaryListener = listener
}

/**
 * The English catalog this process speaks, assembled by {@link registerMessages}
 * from whichever namespaces the surface entry point registered.
 *
 * Seeded with one fragment no surface registers: `errors.i18n.*`, the
 * machinery's own diagnostics (`t()`'s strict-mode failures, the catalog and
 * locale-tag refusals, the dictionary-load warning). The machinery has to be
 * able to word its own failure whatever was — or was not — registered, and a
 * strict "missing key" failure must never depend on a key that could itself be
 * missing.
 *
 * Mutated in place rather than replaced, so the entry in {@link dictionaries}
 * (and anything else holding the reference) always sees the current set.
 */
const english: LocaleCatalog = { ...errorsI18nMessages }

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
  dictionaryListener?.()
}

/** The dictionary registered for a locale, or `undefined` when none is loaded. */
export function getDictionary(tag: LocaleTag): LocaleCatalog | undefined {
  return dictionaries.get(tag)
}

/**
 * The locales this build ships baked dictionaries for, as the CLI process
 * recorded them at boot ({@link registerBakedLocales}) — a fact of the build,
 * not of the language anyone picked. Empty in a browser, which fetches its
 * dictionaries instead, and in a process that never booted the CLI.
 */
let bakedTags: readonly LocaleTag[] = []

/**
 * Record the locales whose dictionaries this build bakes in. Called where the
 * CLI registers them (`loadBundledDictionaries` in `src/cli/locale.ts`), and by
 * tests that simulate a build shipping a language.
 */
export function registerBakedLocales(tags: readonly LocaleTag[]): void {
  bakedTags = [...tags]
}

/**
 * The locales this build ships, for a server-side answer that must not depend
 * on the UI language in force — the admin import route's header-row check reads
 * every shipped language's column headings, whoever runs the server.
 */
export function bakedLocales(): readonly LocaleTag[] {
  return bakedTags
}

/** Every locale a dictionary is loaded for, English first. */
export function loadedLocales(): LocaleTag[] {
  return [...dictionaries.keys()]
}

/** Drop every loaded dictionary except English, and clear the applied locale. For tests. */
export function resetI18nRuntime(): void {
  resetLocale()
  registerLocaleSource(null)
  registerDictionaryListener(null)
  bakedTags = []
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

/** The extension a dictionary file carries. */
const DICTIONARY_EXTENSION = /\.json$/i

/**
 * The file a locale's dictionary is published as inside {@link LOCALES_DIR},
 * and named as when a translator hands one over: `de-AT.json`.
 */
export function localeFileName(tag: LocaleTag): string {
  return `${tag}.json`
}

/**
 * The locale a dictionary file is named for (`de-AT.json` → `de-AT`,
 * canonicalized), or why its name is not a tag. The `.json` extension is
 * optional here; a caller that requires it checks for it first.
 */
export function localeTagFromFileName(name: string): LocaleTag | LocaleTagError {
  return parseLocaleTag(name.replace(DICTIONARY_EXTENSION, ''))
}

/** Whether a file name carries the dictionary extension. */
export function isDictionaryFileName(name: string): boolean {
  return DICTIONARY_EXTENSION.test(name)
}

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
