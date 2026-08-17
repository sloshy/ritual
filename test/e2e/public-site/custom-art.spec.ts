import { test, expect } from '@playwright/test'
import { TINY_PNG } from '../helpers/mock-cards'
import {
  MOCK_DECK_ART_PATH,
  mockPublicSiteCollectionWithUndeployedArt,
  mockPublicSiteProxyDeck,
} from '../helpers/mock-public-site'

/**
 * Custom art on the public site: a baked `customArt` reference replaces the
 * card's own image wherever the card itself is shown, and nowhere else.
 */

test.describe('Custom art', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteProxyDeck(page)
    await page.goto('#/deck/proxy-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('the grid tile shows the custom image, and its neighbour keeps its own', async ({
    page,
  }) => {
    const custom = page.locator('.card-item[data-name="proxy bolt"] .card-binder img')
    await expect(custom).toHaveAttribute('src', MOCK_DECK_ART_PATH)
    // The route served a real PNG, so a decoded image proves the page pointed at
    // something it could load rather than at a broken path.
    await expect.poll(() => custom.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)

    // A card with no art reference is untouched — the site's own image tree.
    await expect(
      page.locator('.card-item[data-name="real ring"] .card-binder img'),
    ).toHaveAttribute('src', 'images/proxy-deck-20.jpg')
  })

  test('the modal shows the custom image while Other Printings keeps the real art', async ({
    page,
  }) => {
    await page.locator('.card-item[data-name="proxy bolt"] .card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.card-modal-image img')).toHaveAttribute('src', MOCK_DECK_ART_PATH)

    // The picture is not the only thing the override decides: this copy is no
    // longer the printing a price would be for, so the meta row names the rule
    // instead of the $10.00 the printing still carries.
    await expect(page.locator('.modal-meta')).toContainText('CUSTOM')
    await expect(page.locator('.modal-meta')).not.toContainText('$10.00')

    // The printings list is what the user opens to see how the card really
    // looks, so the substitution must not reach it.
    await page.getByRole('button', { name: /Other Printings/ }).click()
    await expect(page.locator('.modal-printing-card img').first()).toHaveAttribute('src', TINY_PNG)
  })
})

test.describe('Custom art whose file was not deployed', () => {
  test('the tile still reads CUSTOM instead of a price, and counts as nothing', async ({
    page,
  }) => {
    await mockPublicSiteCollectionWithUndeployedArt(page)
    await page.goto('#/collection/ghost-art-binder')
    await page.waitForSelector('.card-item', { timeout: 15_000 })

    // No display URL was baked, so nothing replaced the card's own art — and
    // the price cell still names the rule, because what makes the copy
    // priceless is the sidecar's claim, not the image the build produced.
    await expect(page.locator('.card-item[data-name="ghost art"] .card-label-price')).toHaveText(
      'CUSTOM',
    )
    await expect(page.locator('.card-item[data-name="real card"] .card-label-price')).toHaveText(
      '$10.00',
    )
    // Both printings are worth $10; only the real card counts toward the total.
    await expect(page.locator('.page-stats')).toContainText('Total: $10.00')
  })
})
