import { expect, type Locator, type Page } from '@playwright/test'
import { pseudoLocalize } from '../../../scripts/generate-locales'
import { en } from '../../../src/i18n/messages/en'
import { enMeta } from '../../../src/i18n/messages/en.meta'
import type { LocaleCatalog, LocaleTag } from '../../../src/i18n/types'
import type { LocaleOverride } from '../../../src/i18n/runtime'
import { localeTag } from '../../../src/i18n/locale-tag'

/**
 * Pin the page's UI locale through the `__ritualLocale__` seam
 * (`src/i18n/runtime.ts`), the same three-tier shape as
 * {@link disableSearchDebounce} and {@link setDefaultLanguage}: it beats the
 * `?locale=` query, `localStorage`, `navigator.languages` and the site's baked
 * default, so a spec can assert against one language without a build flag or a
 * mocked config.
 *
 * Call it before the page navigates — the init script runs on each document
 * load, so it also survives `page.reload()`.
 *
 * **Not** for testing the language *switcher*. The override always wins, which
 * is exactly what makes it useless for a runtime switch: with it set, picking
 * another language in the UI would be overruled on the next read. A spec that
 * switches at runtime drives the switcher (or `?locale=`) instead — see
 * `public-site/locale-switch.spec.ts`.
 */
export async function setLocale(page: Page, tag: LocaleTag): Promise<void> {
  await page.addInitScript((locale: string) => {
    ;(window as unknown as LocaleOverride).__ritualLocale__ = locale
  }, tag)
}

/**
 * The pseudo-locale every locale spec switches to.
 *
 * `en-XA` is generated from English by `scripts/generate-locales.ts`: accented
 * substitutes, padded ~40% longer, and bracketed. The brackets are the point —
 * any text still rendering as plain ASCII after a switch is a string that never
 * went through `t()`.
 */
export const PSEUDO_LOCALE: LocaleTag = localeTag('en-XA')

/**
 * A bracketed run — the `[…]` wrapper `generate-locales.ts` puts around every
 * pseudo-localized message.
 *
 * Deliberately a *containment* test rather than `^\[.*\]$`: most chrome
 * elements wrap their message next to a decorative glyph (`▾`, `↑↓`) or a
 * count badge, and anchoring would fail on the glyph rather than on the string
 * under test.
 */
export const PSEUDO_TEXT = /\[[^[\]]+\]/

/**
 * The pseudo-locale dictionary both switch specs serve to the page.
 *
 * Built lazily and memoized: it is derived from the ~2,900-key English catalog,
 * and each spec file would otherwise pay for its own copy at import time.
 */
let cachedCatalog: LocaleCatalog | undefined
export function pseudoCatalog(): LocaleCatalog {
  cachedCatalog ??= pseudoLocalize(en, enMeta)
  return cachedCatalog
}

/** The header's language `<select>`. Hidden entirely when one locale ships. */
export function languageSelect(page: Page): Locator {
  return page.locator('.language-switcher select')
}

/**
 * Assert a locator's text is (or is not) pseudo-localized — i.e. whether it went
 * through the catalog at all. `toContainText`, not an anchored match: most chrome
 * elements render their message beside a decorative glyph or a count badge.
 */
export async function expectPseudo(locator: Locator, pseudo: boolean): Promise<void> {
  if (pseudo) await expect(locator).toContainText(PSEUDO_TEXT)
  else await expect(locator).not.toContainText(PSEUDO_TEXT)
}

/** The `window` property {@link markPage} sets and {@link expectNotReloaded} reads. */
type SpecMarker = { __localeSpecMarker__?: number }

/**
 * Stamp a marker on `window` that a document reload would wipe. Paired with
 * {@link expectNotReloaded}, it is what makes a switch spec's assertions evidence
 * of a **re-render** rather than of a fresh boot in the new language.
 */
export async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as SpecMarker).__localeSpecMarker__ = 1
  })
}

/** Assert the marker {@link markPage} set is still there. */
export async function expectNotReloaded(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as SpecMarker).__localeSpecMarker__)).toBe(1)
}
