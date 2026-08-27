/**
 * The admin SPA's UI-locale wiring: which language Ritual speaks here, which
 * languages this build can speak, and how a switch is applied.
 *
 * Deliberately **not** the card-language setting (`useDefaultLanguage`). That
 * one picks which printing of a card is recorded; this one picks the language of
 * the interface. A Japanese interface listing English printings is a valid,
 * expected combination.
 *
 * Module-level signals, like `useDefaultCurrency`: every page shares one value,
 * and the header's switcher relabels the whole app.
 */

import { createSignal, type Accessor } from 'solid-js'
import { renderableLocales } from '../../../generated/locales'
import {
  DEFAULT_LOCALE,
  ensureLocaleLoaded,
  readStoredLocale,
  resolveBrowserLocale,
  setLocale as setRuntimeLocale,
  writeStoredLocale,
  type LocaleOverride,
} from '../../../i18n/runtime'
import { isLocaleTagError, parseLocaleTag } from '../../../i18n/locale-tag'
import type { LocaleTag } from '../../../i18n/types'
import { localeDirection } from '../../../site-build/html-shell'

/**
 * Test seam for the locales this deployment offers, mirroring `__ritualLocale__`.
 *
 * The public site learns its locale list from `index.json`, which a spec can
 * mock; the admin's list is baked into the bundle (see {@link availableLocales}),
 * so a spec exercising the *switcher* needs a way in. Never set outside tests.
 */
export type AdminLocalesOverride = { __ritualAdminLocales__?: readonly string[] }

/**
 * Parse a tag list handed in by a test seam. Unparseable entries are dropped
 * rather than failing the boot — the seam is only ever set by a spec, and a
 * typo there should show up as a missing switcher option, not a blank admin.
 */
function parseLocaleList(tags: readonly string[]): LocaleTag[] {
  const parsed: LocaleTag[] = []
  for (const raw of tags) {
    const tag = parseLocaleTag(raw)
    if (!isLocaleTagError(tag)) parsed.push(tag)
  }
  return parsed
}

/**
 * Every locale this admin build can render.
 *
 * `ritual admin` writes exactly these dictionaries into `.admin-dist/locales/`
 * on every start (see `writeAdminBootAssets`), so the list and the files it
 * names come from the same generated module and cannot drift. English is first
 * and is always present — it is inline in the bundle and never fetched.
 */
export function availableLocales(): readonly LocaleTag[] {
  const override = (globalThis as unknown as AdminLocalesOverride).__ritualAdminLocales__
  return override === undefined ? renderableLocales : parseLocaleList(override)
}

const [uiLocale, setUiLocale] = createSignal<LocaleTag>(DEFAULT_LOCALE)

/** The `uiLocale` most recently read from `GET /api/config`, once it has arrived. */
let configuredLocale: string | undefined

/**
 * Stamp the resolved locale onto the document, matching what the shell's
 * `boot.js` did before first paint so a runtime switch leaves no stale `lang`
 * behind for screen readers, hyphenation, or a future RTL stylesheet.
 */
function applyDocumentLocale(tag: LocaleTag): void {
  const element = document.documentElement
  element.lang = tag
  element.dir = localeDirection(tag)
}

/**
 * Load a locale's dictionary and make it the active one. Resolves with the
 * locale actually applied, which is English when the dictionary could not be
 * fetched — a missing translation must not blank the admin.
 */
async function applyLocale(tag: LocaleTag): Promise<LocaleTag> {
  const usable = await ensureLocaleLoaded(tag)
  setRuntimeLocale(usable)
  applyDocumentLocale(usable)
  setUiLocale(usable)
  return usable
}

/**
 * Resolve the locale from every tier currently known and apply it.
 *
 * Re-resolving (rather than patching one tier) is what lets the configured
 * default arrive late without overruling a choice the user has already made:
 * `resolveBrowserLocale` honours the explicit tiers first, so calling this
 * again once `/api/config` lands is idempotent unless nothing more explicit
 * exists.
 */
async function resolveAndApply(): Promise<LocaleTag> {
  return applyLocale(
    resolveBrowserLocale({
      override: (globalThis as unknown as LocaleOverride).__ritualLocale__,
      stored: readStoredLocale(),
      preferred: navigator.languages,
      configured: configuredLocale,
      available: availableLocales(),
    }),
  )
}

/** True once {@link bootAdminLocale} has run, so a remount does not re-resolve. */
let booted = false

/**
 * Resolve and apply the boot locale. Called at the app root, before sign-in, so
 * the login screen already speaks the remembered language.
 */
export function bootAdminLocale(): void {
  if (booted) return
  booted = true
  void resolveAndApply()
}

/**
 * Adopt the workspace's configured `uiLocale`, which only the logged-in shell
 * can read (`/api/config` requires a session). It is the weakest tier, so a
 * remembered or browser-preferred language still wins.
 */
export function adoptConfiguredLocale(tag: string): void {
  if (tag === configuredLocale) return
  configuredLocale = tag
  void resolveAndApply()
}

/**
 * Switch the UI language and remember the choice. Stores what was *applied*,
 * not what was asked for, so a dictionary that could not be fetched does not
 * make every future load retry the same failed request.
 */
export function switchAdminLocale(tag: LocaleTag): void {
  void applyLocale(tag).then(writeStoredLocale)
}

/** The active UI locale, as a reactive accessor. */
export function useAdminLocale(): Accessor<LocaleTag> {
  return uiLocale
}
