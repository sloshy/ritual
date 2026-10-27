import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { localeTag } from '../../../src/i18n/locale-tag-message'
import { fulfillJson } from '../helpers/fulfill'
import {
  headerFold,
  headerRowOverlaps,
  recordFoldTransitions,
  resizeTo,
  rowInset,
  settleLayout,
  takeFoldTransitions,
  unfoldedRowRequirement,
} from '../helpers/header'
import {
  languageSelect,
  pickLanguage,
  pseudoCatalog,
  PSEUDO_LOCALE,
  setLocale,
} from '../helpers/i18n'
import { gotoList, openHeaderUtility, selectCard } from '../helpers/list-ui'
import {
  makeDeckSummary,
  makeSiteIndex,
  mockPublicSiteDeckForFilters,
} from '../helpers/mock-public-site'
import { SYNTHETIC_DECK_SLUG } from '../helpers/synthetic-workspace'

/**
 * The public header folds its utility controls (Prices, Language, Edit, Theme)
 * behind the ⚙ toggle only when they don't fit — never at a fixed width — then
 * drops the quick switch's label if it is tighter still. The decision itself is
 * unit-tested (test/unit/site/header-fit.test.ts); these pin what the browser
 * lays out as the room changes.
 */

/** Window errors a page collected (see {@link recordWindowErrors}). */
type PageErrors = { __pageErrors: string[] }

/** Collect window error events (a ResizeObserver loop surfaces as one); call before `goto`. */
async function recordWindowErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const errors: string[] = []
    ;(window as unknown as PageErrors).__pageErrors = errors
    window.addEventListener('error', (e) => errors.push(e.message))
  })
}

async function windowErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as PageErrors).__pageErrors)
}

const DECK_HASH = `#/deck/${SYNTHETIC_DECK_SLUG}`
const BILINGUAL_HASH = '#/deck/test-filter-deck'

/** A deck on a site publishing English and the pseudo-locale, with two price stores. */
async function mockBilingualSite(page: Page): Promise<void> {
  await mockPublicSiteDeckForFilters(page)
  await fulfillJson(
    page,
    '**/index.json',
    makeSiteIndex({
      decks: [
        makeDeckSummary({ slug: 'test-filter-deck', name: 'Test Filter Deck', cardCount: 6 }),
      ],
      priceSources: ['tcgplayer', 'cardmarket'],
      availableLocales: [localeTag('en'), PSEUDO_LOCALE],
    }),
  )
  await fulfillJson(page, `**/locales/${PSEUDO_LOCALE}.json`, pseudoCatalog())
}

test.describe('header fit', () => {
  test('a selection folds the header only when it needs the room, without flapping', async ({
    page,
  }) => {
    const toggle = page.locator('.header-utility-toggle')
    const inlineEdit = page.locator('.site-header-main .btn-edit')
    await recordFoldTransitions(page)
    await recordWindowErrors(page)

    await page.setViewportSize({ width: 1280, height: 900 })
    await gotoList(page, DECK_HASH)
    await settleLayout(page)
    await expect(inlineEdit).toBeVisible()
    await expect(page.locator('.site-header-main .currency-select')).toBeVisible()
    await expect(page.locator('.site-header-main .theme-customize-btn')).toBeVisible()
    await expect(toggle).toHaveCount(0)

    // Room to spare at 1200 — until the navbar's "All Selected (N)" arrives.
    await resizeTo(page, 1200)
    await expect(toggle).toHaveCount(0)
    await takeFoldTransitions(page)

    await selectCard(page, 0)
    await expect(toggle).toBeVisible()
    await expect(inlineEdit).toHaveCount(0)
    expect(await headerRowOverlaps(page)).toEqual([])
    expect(await takeFoldTransitions(page)).toEqual(['full→folded'])

    await selectCard(page, 0)
    await expect(inlineEdit).toBeVisible()
    await expect(toggle).toHaveCount(0)
    expect(await headerRowOverlaps(page)).toEqual([])
    expect(await takeFoldTransitions(page)).toEqual(['folded→full'])

    // Around the boundary with the selection back, placed from the measured
    // requirement so it holds whatever the platform's fonts. Unfolding needs
    // UNFOLD_SLACK (24px) beyond the requirement; folding needs none.
    await selectCard(page, 0)
    await resizeTo(page, 1600)
    await expect(page.locator('.site-header')).toHaveAttribute('data-fold', 'full')
    const boundary = (await unfoldedRowRequirement(page)) + (await rowInset(page))
    await takeFoldTransitions(page)

    const steps: [number, string, string[]][] = [
      [Math.ceil(boundary) + 8, 'full', []], // still fits, and it was unfolded
      [Math.floor(boundary) - 8, 'folded', ['full→folded']],
      [Math.ceil(boundary) + 8, 'folded', []], // fits, but inside the slack
      [Math.ceil(boundary) + 40, 'full', ['folded→full']],
    ]
    const header = page.locator('.site-header')
    for (const [width, fold, transitions] of steps) {
      await resizeTo(page, width)
      if (transitions.length > 0) {
        await expect(header, `at ${width}px`).toHaveAttribute('data-fold', fold)
      } else {
        // A level that must hold: one more frame, so a late re-measure would
        // have shown up before the read.
        await settleLayout(page)
        expect(await headerFold(page), `at ${width}px`).toBe(fold)
      }
      expect(await takeFoldTransitions(page), `at ${width}px`).toEqual(transitions)
      expect(await headerRowOverlaps(page), `at ${width}px`).toEqual([])
    }
    expect(await windowErrors(page)).toEqual([])
  })

  test('tighter still, the quick switch drops to its icon and gets its label back', async ({
    page,
  }) => {
    const label = page.locator('.quick-switch-trigger-label')
    await recordWindowErrors(page)
    await page.setViewportSize({ width: 768, height: 900 })
    await gotoList(page, DECK_HASH)
    await selectCard(page, 0)
    await expect(page.locator('.site-header')).toHaveAttribute('data-fold', 'icon')
    await expect(label).toBeHidden()
    expect(await headerRowOverlaps(page)).toEqual([])

    await resizeTo(page, 1000)
    await expect(page.locator('.site-header')).toHaveAttribute('data-fold', 'folded')
    await expect(label).toBeVisible()
    expect(await headerRowOverlaps(page)).toEqual([])
    expect(await windowErrors(page)).toEqual([])
  })

  test('a focused control that folds away hands focus to the ⚙ toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
    await page.locator('.site-header-main .btn-edit').focus()

    await resizeTo(page, 900)
    const toggle = page.locator('.header-utility-toggle')
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('Edit becoming the wider Done can fold the header, and focus follows to ⚙', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await gotoList(page, DECK_HASH)
    await selectCard(page, 0)
    await settleLayout(page)
    // Just wide enough for the row with "Edit" (the selection makes the right
    // side the wider one), not for the same row with "Done".
    const boundary = (await unfoldedRowRequirement(page)) + (await rowInset(page))
    await resizeTo(page, Math.ceil(boundary) + 2)
    await expect(page.locator('.site-header')).toHaveAttribute('data-fold', 'full')

    await page.locator('.site-header-main .btn-edit').click()
    await expect(page.locator('.site-header')).toHaveAttribute('data-fold', 'folded')
    const toggle = page.locator('.header-utility-toggle')
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await headerRowOverlaps(page)).toEqual([])
  })

  test('picking themes in the folded ⚙ row keeps the theme picker open', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('/')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
    await openHeaderUtility(page, page.locator('.theme-customize-btn'))
    await page.locator('.theme-customize-btn').click()
    const dialog = page.getByRole('dialog', { name: 'Choose theme' })
    await dialog.getByRole('option', { name: /izzet/ }).first().click()
    await settleLayout(page)
    await expect(dialog).toBeVisible()
    await expect(page.locator('.site-header-utility')).toBeVisible()
  })

  test('the ⚙ toggle reveals and hides the folded utility row', async ({ page }) => {
    const toggle = page.locator('.header-utility-toggle')
    const utilityRow = page.locator('.site-header-utility')

    await page.setViewportSize({ width: 900, height: 900 })
    await page.goto('/')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
    await expect(page.locator('.site-nav')).toBeVisible()
    await expect(page.locator('.btn-edit')).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(utilityRow).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(utilityRow.locator('.currency-select')).toBeVisible()
    await expect(utilityRow.locator('.btn-edit')).toBeVisible()
    await expect(utilityRow.locator('.theme-customize-btn')).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(utilityRow).toHaveCount(0)

    // Phones trade the nav links for the bottom tab bar; ⚙ stays.
    await resizeTo(page, 375, 667)
    await expect(page.locator('.site-nav')).toBeHidden()
    await expect(page.locator('.mobile-tabbar')).toBeVisible()
    await expect(toggle).toBeVisible()
    await expect(page.locator('.btn-edit')).toHaveCount(0)
  })
})

test.describe('header fit on a bilingual site', () => {
  test.beforeEach(async ({ page }) => {
    await mockBilingualSite(page)
  })

  test('the language picker sits inline where it fits and behind ⚙ where it does not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1700, height: 900 })
    await page.goto(BILINGUAL_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await expect(page.locator('.site-header-main .language-switcher select')).toBeVisible()

    await resizeTo(page, 1280)
    await expect(page.locator('.site-header-main .language-switcher')).toHaveCount(0)
    await openHeaderUtility(page, languageSelect(page))
    await expect(page.locator('.site-header-utility .language-switcher select')).toBeVisible()
  })

  test('re-measures the folded controls when the language changes, and unfolds when they fit', async ({
    page,
  }) => {
    const header = page.locator('.site-header')
    await page.setViewportSize({ width: 1700, height: 900 })
    await page.goto(BILINGUAL_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await expect(header).toHaveAttribute('data-fold', 'full')

    // The pseudo-locale's longer labels no longer fit…
    await pickLanguage(page, PSEUDO_LOCALE)
    await expect(header).toHaveAttribute('data-fold', 'folded')
    // …and back in English the header finds the room again. Its cached
    // widths are the pseudo-locale's (taken inline, never from the ⚙ row), so
    // getting there means re-measuring the folded controls in English.
    await pickLanguage(page, 'en')
    // Not while the ⚙ row is open (re-measuring would remount its controls);
    // closing it lets the header re-measure and unfold.
    await expect(header).toHaveAttribute('data-fold', 'folded')
    await page.locator('.header-utility-toggle').click()
    await expect(header).toHaveAttribute('data-fold', 'full')
    expect(await headerRowOverlaps(page)).toEqual([])
  })

  test('a long translation folds a wide header and never widens the page at 768px', async ({
    page,
  }) => {
    await setLocale(page, PSEUDO_LOCALE)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(BILINGUAL_HASH)
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    const header = page.locator('.site-header')
    await expect(header).toHaveAttribute('data-fold', 'folded')
    expect(await headerRowOverlaps(page)).toEqual([])

    // Even the icon level is too wide here: the nav scrolls within itself.
    await resizeTo(page, 768)
    await expect(header).toHaveAttribute('data-fold', 'icon')
    expect(await headerRowOverlaps(page)).toEqual([])
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    expect(widths.page).toBeLessThanOrEqual(widths.viewport)
  })
})
