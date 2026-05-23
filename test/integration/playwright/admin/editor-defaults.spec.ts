import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { disableSearchDebounce } from '../helpers/search-modal'

const FOIL_BOLT = {
  id: 'bolt-foil',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: {
    usd: '1.00',
    usd_foil: '5.00',
    usd_etched: null,
    eur: '0.80',
    eur_foil: null,
    tix: null,
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  color_identity: ['R'],
}

const FOIL_BOLT_FDN = {
  ...FOIL_BOLT,
  id: 'bolt-fdn',
  set: 'fdn',
  set_name: 'Foundations',
  collector_number: '125',
}

test.describe('Admin Editor — Add Card Defaults', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await loginAsAdmin(page)

    // Clear any previously persisted defaults so each test starts fresh.
    // Note: this runs once on the already-loaded admin page rather than via
    // addInitScript — addInitScript would re-fire on page.reload() and wipe
    // the value the persistence test just set.
    await page.evaluate(() => {
      window.localStorage.removeItem('ritual:admin:defaults:deck')
      window.localStorage.removeItem('ritual:admin:defaults:collection')
      window.localStorage.removeItem('ritual:admin:defaults:wanted')
    })

    await page.route('**/api/decks', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ decks: [{ slug: 'test-defaults-deck', name: 'Defaults Deck' }] }),
        })
      } else {
        await route.continue()
      }
    })

    await page.route('**/api/deck/test-defaults-deck', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          slug: 'test-defaults-deck',
          deck: {
            name: 'Defaults Deck',
            sections: [
              {
                name: 'Main',
                cards: [
                  { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
                ],
              },
            ],
          },
          cards: { 'Lightning Bolt': FOIL_BOLT },
          printings: { 'Lightning Bolt': [FOIL_BOLT, FOIL_BOLT_FDN] },
          lowestPriceCards: { 'Lightning Bolt': FOIL_BOLT },
          lowestPriceCardsEur: { 'Lightning Bolt': FOIL_BOLT },
          lowestPriceCardsTix: {},
          symbolMap: {},
          frontMatter: {},
        }),
      })
    })

    await page.route('**/api/autocomplete*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, names: ['Lightning Bolt'] }),
      })
    })

    await page.route('**/api/card-printings*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, printings: [FOIL_BOLT, FOIL_BOLT_FDN] }),
      })
    })

    await page.route('**/api/card-price*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          printings: [FOIL_BOLT],
          representative: FOIL_BOLT,
          lowestPriceCard: FOIL_BOLT,
          lowestPriceCardEur: FOIL_BOLT,
          lowestPriceCardTix: null,
        }),
      })
    })

    await page.locator('.admin-nav-item:has-text("Deck Editor")').click()
    await expect(page.locator('.section-heading')).toContainText('Deck Editor')

    const select = page.locator('.deck-selector')
    await select.waitFor({ state: 'visible' })
    await page.waitForFunction(
      () => (document.querySelector('.deck-selector')?.children.length ?? 0) > 1,
      { timeout: 10_000 },
    )
    await select.selectOption('test-defaults-deck')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  test('defaults bar is visible and collapses by default with no defaults set', async ({
    page,
  }) => {
    const toggle = page.locator('.editor-defaults-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toContainText('Add Card Defaults')
    await expect(toggle.locator('.editor-defaults-summary')).toContainText('none')
  })

  test('default finish auto-skips finish/condition step on foil-capable printing', async ({
    page,
  }) => {
    // Expand the defaults panel and pick foil. The regex form keeps the match
    // case-sensitive so it does not also match "Nonfoil".
    await page.locator('.editor-defaults-toggle').click()
    const foilOption = page.locator('.editor-defaults-option', { hasText: /Foil/ })
    await foilOption.click()
    await expect(foilOption).toHaveClass(/editor-defaults-option--selected/)

    // Open the search modal and pick Lightning Bolt
    await page.locator('.site-btn-add').click()
    const searchInput = page.locator('.search-modal input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Lightning')
    const result = page.locator('.search-result-item', { hasText: 'Lightning Bolt' })
    await expect(result).toBeVisible({ timeout: 5_000 })
    await result.click()

    // Should be on printing step (modal still open)
    await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing')

    // Pick the LEA printing — defaults.finish=foil applies, so the finish/condition
    // step is auto-skipped and the modal closes immediately. Use the backdrop
    // selector since `.search-modal` is also used as a styling hook on the
    // always-mounted ChangesDialog <dialog>.
    await page.locator('.printing-select-card', { hasText: 'LEA #161' }).click()
    await expect(page.locator('.search-modal-backdrop')).toHaveCount(0, { timeout: 5_000 })

    // A new pending change should appear.
    await expect(page.locator('.changes-badge')).toBeVisible()
  })

  test('default set code narrows printing grid and auto-picks single match', async ({ page }) => {
    // Expand defaults and enter "FDN"
    await page.locator('.editor-defaults-toggle').click()
    const setsInput = page.locator('#defaults-sets')
    await setsInput.fill('FDN')
    await setsInput.press('Enter')

    // Adding Lightning Bolt should auto-skip the printing step (only FDN matches)
    // and proceed straight to finish-condition because finish isn't defaulted.
    await page.locator('.site-btn-add').click()
    const searchInput = page.locator('.search-modal input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Lightning')
    const result = page.locator('.search-result-item', { hasText: 'Lightning Bolt' })
    await expect(result).toBeVisible({ timeout: 5_000 })
    await result.click()

    // Should land on the finish-condition step for the FDN printing — its set is FDN.
    await expect(page.locator('.modal-heading-flex')).toContainText('FDN', { timeout: 5_000 })
  })

  test('defaults persist across reload via localStorage', async ({ page }) => {
    await page.locator('.editor-defaults-toggle').click()
    const foilOption = page.locator('.editor-defaults-option', { hasText: /Foil/ })
    await foilOption.click()

    // Reload and revisit the deck editor — defaults should persist.
    await page.reload()
    await page.locator('.admin-nav-item:has-text("Deck Editor")').click()
    const toggle = page.locator('.editor-defaults-toggle')
    await expect(toggle).toBeVisible()
    // When defaults are active the bar mounts expanded (no summary chip is
    // rendered), so verify persistence by checking the Foil radio's selected
    // state directly. The regex form keeps the match case-sensitive so it
    // does not also match "Nonfoil".
    await expect(page.locator('.editor-defaults-option', { hasText: /Foil/ })).toHaveClass(
      /editor-defaults-option--selected/,
    )
  })
})
