import { test, expect, type Page } from '@playwright/test'
import { mockPublicSiteCollectionForPriceSources } from '../helpers/mock-public-site'
import { gotoList } from '../helpers/list-ui'

/**
 * The price-source selector on the public site: with both USD stores enabled
 * (`priceSources: ["tcgplayer", "cardkingdom"]`) a **Prices** toolbar select
 * appears, switching it re-prices the page from the baked Card Kingdom retail
 * quotes (with honest N/A for printings CK does not sell), and the choice
 * rides in the shareable URL. With `priceSources: []` every price surface
 * disappears.
 *
 * The store logic itself is pinned in test/unit/site/price-view.test.ts —
 * this spec covers the state transitions the UI performs with it. The mocked
 * collection's baked quotes give the bought card an $8 CK retail (Scryfall
 * $10) and the unlisted card no quote at all (Scryfall $30).
 */

const SOURCE_SELECT = '#price-source'

async function gotoSellBinder(page: Page): Promise<void> {
  await gotoList(page, '#/collection/sell-binder')
}

async function switchToListView(page: Page): Promise<void> {
  await page.locator('[data-view="list"]').click()
  await page.waitForSelector('.card-list', { timeout: 10_000 })
}

/** The list row for a card name. */
function row(page: Page, name: string) {
  return page.locator('.card-list', { hasText: name })
}

test.describe('price-source selector', () => {
  test('switching to Card Kingdom re-prices from baked retail and updates the URL', async ({
    page,
  }) => {
    await mockPublicSiteCollectionForPriceSources(page)
    await gotoSellBinder(page)
    await switchToListView(page)

    // TCGplayer (default): Scryfall prices, no URL param.
    await expect(row(page, 'Bought Card').locator('.list-price')).toHaveText('$10.00')
    await expect(row(page, 'Unlisted Card').locator('.list-price')).toHaveText('$30.00')

    const select = page.locator(SOURCE_SELECT)
    await expect(select).toBeVisible()
    await select.selectOption('cardkingdom')

    // CK retail from the baked quotes; a printing CK does not sell is N/A.
    await expect(row(page, 'Bought Card').locator('.list-price')).toHaveText('$8.00')
    await expect(row(page, 'Unlisted Card').locator('.list-price')).toHaveText('N/A')
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain('prices=cardkingdom')

    // The page total follows the store: 8 + 18 (paused product's retail stands).
    await expect(page.locator('.page-stats')).toContainText('$26.00')

    // Back to TCGplayer: prices restore. The pick stays in the URL — it is
    // now an explicit choice (a sell-mode link uses exactly this to pin
    // "compare vs market" against the courtesy Card Kingdom default); only
    // the untouched default stays out (see the first assertion above).
    await select.selectOption('tcgplayer')
    await expect(row(page, 'Bought Card').locator('.list-price')).toHaveText('$10.00')
    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('prices=tcgplayer')
  })

  test('a shared URL restores the Card Kingdom view', async ({ page }) => {
    await mockPublicSiteCollectionForPriceSources(page)
    await gotoList(page, '#/collection/sell-binder?prices=cardkingdom')
    await switchToListView(page)
    await expect(page.locator(SOURCE_SELECT)).toHaveValue('cardkingdom')
    await expect(row(page, 'Bought Card').locator('.list-price')).toHaveText('$8.00')
  })

  test('with a single store there is no selector', async ({ page }) => {
    await mockPublicSiteCollectionForPriceSources(page, { priceSources: ['tcgplayer'] })
    await gotoSellBinder(page)
    await expect(page.locator('.toolbar')).toBeVisible()
    await expect(page.locator(SOURCE_SELECT)).toHaveCount(0)
  })

  test('an empty priceSources hides every price surface', async ({ page }) => {
    await mockPublicSiteCollectionForPriceSources(page, { priceSources: [] })
    await gotoSellBinder(page)
    await switchToListView(page)

    // Cards render, but without prices; totals and the currency selector are gone.
    await expect(page.locator('.card-list').first()).toBeVisible()
    await expect(page.locator('.list-price')).toHaveCount(0)
    await expect(page.locator('.currency-selector')).toHaveCount(0)
    // Visible first, so the money assertion cannot pass vacuously on a page
    // that failed to render its stats line at all.
    await expect(page.locator('.page-stats')).toBeVisible()
    await expect(page.locator('.page-stats')).not.toContainText('$')
    await expect(page.locator(SOURCE_SELECT)).toHaveCount(0)
  })
})
