import { test, expect, type Page } from '@playwright/test'
import {
  mockPublicSiteCollectionForPriceSources,
  mockPublicSiteDeckForPriceSources,
} from '../helpers/mock-public-site'
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

test.describe('per-store representative printings', () => {
  /** The card id of the printing a tile is displaying, read off its image src. */
  function tileImage(page: Page) {
    return page.locator('.card-item').filter({ hasText: 'Split Pick' }).first().locator('img')
  }

  test('switching to Card Kingdom swaps the printing a name-only deck card displays', async ({
    page,
  }) => {
    await mockPublicSiteDeckForPriceSources(page)
    await gotoList(page, '#/deck/split-pick-deck')

    // The displayed printing itself moves, not just the figure beside it: the
    // tile's image names the card id it is rendering.
    await expect(tileImage(page)).toHaveAttribute('src', /ck-pick-scryfall/)
    await page.locator(SOURCE_SELECT).selectOption('cardkingdom')
    await expect(tileImage(page)).toHaveAttribute('src', /ck-pick-kingdom/)
    await page.locator(SOURCE_SELECT).selectOption('tcgplayer')

    await switchToListView(page)

    // TCGplayer: the Scryfall-picked printing, at its Scryfall price.
    await expect(row(page, 'Split Pick').locator('.list-price')).toHaveText('$10.00')

    await page.locator(SOURCE_SELECT).selectOption('cardkingdom')

    // CK stocks no product for the Scryfall pick, so $3.00 is only reachable by
    // displaying CK's own pick — an unswapped page would read N/A here.
    await expect(row(page, 'Split Pick').locator('.list-price')).toHaveText('$3.00')
    await expect(page.locator('.page-stats')).toContainText('$3.00')

    await page.locator(SOURCE_SELECT).selectOption('tcgplayer')
    await expect(row(page, 'Split Pick').locator('.list-price')).toHaveText('$10.00')
  })

  test('the other-printings grid prices each printing from the selected store', async ({
    page,
  }) => {
    const watch = await mockPublicSiteDeckForPriceSources(page)
    await gotoList(page, '#/deck/split-pick-deck')
    await page.locator('.card-item').first().locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Other Printings/ }).click()

    // Anchored: a printing numbered 14 or 41 would otherwise satisfy `DFN:4`.
    const tile = (label: string) =>
      page.locator('.modal-printing-card').filter({ hasText: new RegExp(`\\b${label}\\b`) })

    // TCGplayer: Scryfall money, with the dual-finish printing's foil listed
    // underneath its nonfoil price.
    await expect(tile('TST:1').locator('.printing-price-main')).toHaveText('$10.00')
    await expect(tile('DFN:4').locator('.printing-price-main')).toHaveText('$5.00')
    await expect(tile('DFN:4').locator('.printing-price-alt')).toHaveText('$20.00 (foil)')

    // The dialog carries its own copy of the one selector; switching it here is
    // switching it everywhere.
    const modalSource = page.locator('#card-modal-price-source')
    await expect(modalSource).toHaveValue('tcgplayer')
    await modalSource.selectOption('cardkingdom')

    // CK retail, per finish. The printing CK does not stock reads N/A rather
    // than falling back to its TCGplayer price.
    await expect(tile('CKP:2').locator('.printing-price-main')).toHaveText('$3.00')
    await expect(tile('DFN:4').locator('.printing-price-main')).toHaveText('$4.00')
    await expect(tile('DFN:4').locator('.printing-price-alt')).toHaveText('$15.00 (foil)')
    await expect(tile('TST:1').locator('.printing-price-main')).toHaveText('N/A')

    // One store, one signal: the page's own selector moved with it.
    await page.locator('.modal-close').click()
    await expect(page.locator(SOURCE_SELECT)).toHaveValue('cardkingdom')

    // All of that came from the detail's baked quotes. A static site has no
    // backend to ask, so quoting on demand here would 500 and price nothing.
    expect(watch.requests).toEqual([])
  })

  test('with prices switched off the grid shows no money at all', async ({ page }) => {
    await mockPublicSiteDeckForPriceSources(page, { priceSources: [] })
    await gotoList(page, '#/deck/split-pick-deck')
    await page.locator('.card-item').first().locator('.card-binder').click()
    await page.getByRole('button', { name: /Other Printings/ }).click()

    // The positive control first: the grid rendered, it is simply priceless.
    await expect(page.locator('.modal-printing-card')).toHaveCount(4)
    await expect(page.locator('.printing-prices')).toHaveCount(0)
    await expect(page.locator('#card-modal-price-source')).toHaveCount(0)
  })

  test('"Lowest Price" under Card Kingdom uses the cheapest printing CK sells', async ({
    page,
  }) => {
    await mockPublicSiteDeckForPriceSources(page)
    await gotoList(page, '#/deck/split-pick-deck')
    await switchToListView(page)
    await page.locator(SOURCE_SELECT).selectOption('cardkingdom')
    await expect(row(page, 'Split Pick').locator('.list-price')).toHaveText('$3.00')

    // A third printing again: $1.50 is CK's cheapest, and is reachable only
    // through the CK lowest-price map — the Scryfall one points at a printing
    // CK does not stock, which would read N/A.
    await page.locator('.toolbar button.toolbar-toggle', { hasText: 'Lowest Price' }).click()
    await expect(row(page, 'Split Pick').locator('.list-price')).toHaveText('$1.50')
  })
})
