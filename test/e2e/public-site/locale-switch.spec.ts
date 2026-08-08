import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { LOCALE_STORAGE_KEY } from '../../../src/i18n/runtime'
import { fulfillJson } from '../helpers/fulfill'
import { openFilterMenu } from '../helpers/filter-menu'
import {
  expectNotReloaded,
  expectPseudo,
  languageSelect,
  markPage,
  pseudoCatalog,
  PSEUDO_LOCALE,
} from '../helpers/i18n'
import { localeTag } from '../../../src/i18n/locale-tag'
import type { LocaleTag } from '../../../src/i18n/types'
import {
  makeDeckSummary,
  makeSiteIndex,
  mockPublicSiteDeckForFilters,
} from '../helpers/mock-public-site'

/**
 * Switching the UI language at runtime.
 *
 * The property under test is the one that cannot be unit-tested: module-level
 * label tables (`NAV_DESTINATIONS`, the toolbar's view-mode titles, the filter
 * menu's match-mode copy, the index sort options) are evaluated once at import,
 * so a table holding rendered strings would leave the chrome in the boot-time
 * language while the surrounding page translated. Every table holds message
 * *keys* instead — and this spec is what proves it, because solid-js resolves
 * to its server build under `bun test` and no Solid reactivity can be pinned
 * there at all.
 *
 * The target language is the generated pseudo-locale: every message comes back
 * accented, padded and **bracketed**, so "did this string go through `t()`?"
 * is a bracket test rather than a translation anyone has to write. Text
 * still rendering as plain ASCII after the switch is a hardcoded literal.
 *
 * Selection is by CSS class throughout, never by accessible name: the names are
 * exactly what these tests change.
 */

/** The pseudo-locale dictionary, derived from the live catalog rather than a fixture. */

const DECK_SLUG = 'test-filter-deck'
const DECK_HASH = `#/deck/${DECK_SLUG}`

/**
 * The filter deck, on a site that publishes both English and the pseudo-locale.
 *
 * Registered after `mockPublicSiteDeckForFilters` so it wins: Playwright matches
 * route handlers in reverse registration order, so this index replaces that
 * helper's English-only one while its deck payload still answers.
 */
async function mockBilingualSite(
  page: Page,
  available: LocaleTag[] = [localeTag('en'), PSEUDO_LOCALE],
) {
  await mockPublicSiteDeckForFilters(page)
  await fulfillJson(
    page,
    '**/index.json',
    makeSiteIndex({
      decks: [makeDeckSummary({ slug: DECK_SLUG, name: 'Test Filter Deck', cardCount: 6 })],
      availableCurrencies: ['usd', 'eur'],
      availableLocales: available,
    }),
  )
  await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
}

/** Every string this spec watches, by CSS class — one per chrome surface. */
function chromeTexts(page: Page) {
  return {
    // The header nav, rendered from the shared NAV_DESTINATIONS table — the
    // table whose staleness this whole spec exists to catch. (The phone tab bar
    // renders the same list and mounts only at phone widths.)
    nav: page.locator('.site-nav-link').first(),
    // "Group:" — the toolbar's own label, beside the grouping dropdown.
    toolbarLabel: page.locator('.toolbar-label').first(),
    // The Filters toolbar chip.
    filterChip: page.locator('.filter-menu > button'),
  }
}

test.describe('public site language switch', () => {
  test.beforeEach(async ({ page }) => {
    await mockBilingualSite(page)
  })

  test('relabels the nav, the toolbar and an open filter panel in one render', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // A marker on `window` that a reload would wipe: it is what makes the
    // assertions below evidence of a re-render rather than of a fresh boot.
    await markPage(page)

    const chrome = chromeTexts(page)
    await expect(chrome.nav).toHaveText('Decks')
    await expect(chrome.toolbarLabel).toHaveText('Group:')
    await expect(chrome.filterChip).toContainText('Filters')

    // The filter panel stays open across the switch — `selectOption` sets the
    // value without a mouse press, so the panel's outside-mousedown dismissal
    // never fires. That is the point: a panel already on screen has to
    // re-render in place, not on its next open.
    const panel = await openFilterMenu(page)
    const panelLabel = panel.locator('.filter-label').first()
    const matchModeButton = panel.locator('.filter-toggle-group button').first()
    await expect(panelLabel).toHaveText('Name')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expect(panel).toBeVisible()
    await expectPseudo(chrome.nav, true)
    await expectPseudo(chrome.toolbarLabel, true)
    await expectPseudo(chrome.filterChip, true)
    await expectPseudo(panelLabel, true)
    await expectPseudo(matchModeButton, true)

    await expectNotReloaded(page)
  })

  test('stamps the document language and remembers the choice', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await languageSelect(page).selectOption(PSEUDO_LOCALE)

    await expect(page.locator('html')).toHaveAttribute('lang', PSEUDO_LOCALE)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), LOCALE_STORAGE_KEY))
      .toBe(PSEUDO_LOCALE)
  })

  test('survives navigation within the SPA', async ({ page }) => {
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await languageSelect(page).selectOption(PSEUDO_LOCALE)
    await expectPseudo(chromeTexts(page).toolbarLabel, true)

    // `page.evaluate` on the hash, never `page.goto`: goto reloads the document
    // and would re-boot the app, which proves nothing about the running one.
    await page.evaluate(() => {
      window.location.hash = '#/collections'
    })

    // The index tabs render their own headings and toolbar from separate label
    // tables, so this also covers the index sort/group dropdowns.
    await expectPseudo(page.locator('.section-title'), true)
    await expectPseudo(page.locator('.site-nav-link').first(), true)
  })

  test('?locale= in the hash query outranks the remembered choice', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, 'en')
    }, LOCALE_STORAGE_KEY)

    await page.goto(`${DECK_HASH}?locale=${PSEUDO_LOCALE}`)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    await expectPseudo(chromeTexts(page).toolbarLabel, true)
    await expect(languageSelect(page)).toHaveValue(PSEUDO_LOCALE)
  })

  test('hides itself when the site ships a single locale', async ({ page }) => {
    await mockBilingualSite(page, [localeTag('en')])
    await page.goto(DECK_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    await expect(languageSelect(page)).toHaveCount(0)
    await expectPseudo(chromeTexts(page).toolbarLabel, false)
  })
})
