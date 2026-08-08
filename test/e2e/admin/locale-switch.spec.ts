import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../../../src/i18n/runtime'
import type { AdminLocalesOverride } from '../../../src/admin/site/hooks/useAdminLocale'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import {
  expectNotReloaded,
  expectPseudo,
  languageSelect,
  markPage,
  pseudoCatalog,
  PSEUDO_LOCALE,
} from '../helpers/i18n'
import { mockDecksApi, mockCollectionsApi } from '../helpers/mock-admin'

/**
 * Switching the admin's UI language at runtime — the twin of
 * `public-site/locale-switch.spec.ts`, and for the same reason.
 *
 * The property under test cannot be unit-tested: module-level label tables
 * (`PAGE_DISPLAY`, `LIST_TYPE_DISPLAY`, the dashboard's tile descriptions, the
 * sync pages' choice options) are evaluated once at import, so a table holding
 * rendered strings would leave the sidebar, the headings and the tabs in the
 * boot-time language while the surrounding page translated. Every table holds
 * message *keys* instead — and this spec is what proves it, because solid-js
 * resolves to its server build under `bun test` and no Solid reactivity can be
 * pinned there at all.
 *
 * The target language is the generated pseudo-locale: every message comes back
 * accented, padded and **bracketed**, so "did this string go through `t()`?" is
 * a bracket test rather than a translation anyone has to write.
 *
 * Selection is by CSS class throughout, never by accessible name: the names are
 * exactly what these tests change.
 */

/** The pseudo-locale dictionary, derived from the live catalog rather than a fixture. */

/**
 * Advertise a locale set to the admin app and answer for its dictionary.
 *
 * The admin's locale list is baked into the bundle from
 * `src/generated/locales.ts` (the same module that decides which files
 * `ritual admin` writes into `.admin-dist/locales/`), so a spec exercising the
 * *switcher* has to widen it through the `__ritualAdminLocales__` seam. The
 * dictionary itself is served by route interception, exactly as the public
 * spec serves `locales/en-XA.json`.
 */
async function offerLocales(page: Page, tags: string[]): Promise<void> {
  await page.addInitScript((locales: string[]) => {
    ;(window as unknown as AdminLocalesOverride).__ritualAdminLocales__ = locales
  }, tags)
  await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
}

/** Every string this spec watches, by CSS class — one per module-level table. */
function chromeTexts(page: Page) {
  return {
    // The sidebar, rendered from PAGE_DISPLAY — the table whose staleness this
    // whole spec exists to catch.
    nav: page.locator('.admin-sidebar .admin-nav-item').first(),
    // The page's own heading, which reads the same table.
    heading: page.locator('.section-heading'),
    // A dashboard tile's description, from the page's own module-level table.
    cardDesc: page.locator('.admin-card-desc').first(),
  }
}

test.describe('admin language switch', () => {
  test('relabels the sidebar, the heading and the dashboard tiles in one render', async ({
    page,
  }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page)

    // A marker on `window` that a reload would wipe: it is what makes the
    // assertions below evidence of a re-render rather than of a fresh boot.
    await markPage(page)

    // `toContainText` throughout: every one of these renders its message next to
    // a decorative glyph, and anchoring would fail on the glyph rather than on
    // the string under test.
    const chrome = chromeTexts(page)
    await expect(chrome.nav).toContainText('Dashboard')
    await expect(chrome.heading).toContainText('Dashboard')
    await expect(chrome.cardDesc).toContainText('Edit decks')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expectPseudo(chrome.nav, true)
    await expectPseudo(chrome.heading, true)
    await expectPseudo(chrome.cardDesc, true)

    await expectNotReloaded(page)
  })

  test('relabels an open Manage Lists form, whole phrase per list type', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await mockDecksApi(page)
    await mockCollectionsApi(page)
    await gotoAdminDashboard(page, '#/lists')

    // The list-type tabs come from LIST_TYPE_DISPLAY, shared with the CLI and
    // the public site — one table, three surfaces.
    const tab = page.locator('.list-type-tab').first()
    await expect(tab).toContainText('Decks')

    // "Create New Deck" is one message per list type, not a verb glued to a
    // capitalized noun (plan §7.3) — so it survives the switch as a whole
    // sentence rather than as a half-translated splice.
    await page.locator('.btn-primary:has-text("New Deck")').click()
    const formHeading = page.locator('.section-subheading')
    await expect(formHeading).toHaveText('Create New Deck')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    // The form stays open across the switch: selecting an option never moves
    // focus out of the page, so this is a re-render in place.
    await expectPseudo(formHeading, true)
    await expectPseudo(tab, true)
  })

  test('stamps the document language and remembers the choice', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expect(page.locator('html')).toHaveAttribute('lang', PSEUDO_LOCALE)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), LOCALE_STORAGE_KEY))
      .toBe(PSEUDO_LOCALE)
  })

  test('survives navigation within the SPA', async ({ page }) => {
    await offerLocales(page, ['en', PSEUDO_LOCALE])
    await gotoAdminDashboard(page)
    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(chromeTexts(page).nav, true)

    // `page.evaluate` on the hash, never `page.goto`: goto reloads the document
    // and would re-boot the app, which proves nothing about the running one.
    await page.evaluate(() => {
      window.location.hash = '#/build'
    })

    await expectPseudo(page.locator('.section-heading'), true)
    await expectPseudo(page.locator('.page-desc'), true)
  })

  test('hides itself when this build ships a single locale', async ({ page }) => {
    await offerLocales(page, ['en'])
    await gotoAdminDashboard(page)

    await expect(languageSelect(page)).toHaveCount(0)
    await expectPseudo(chromeTexts(page).nav, false)
  })
})
