import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

test.describe('Edit Lists page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-nav-item:has-text("Edit Lists")').click()
    await expect(page.locator('.section-heading')).toContainText('Edit Lists')
  })

  test('switching type tabs swaps the mounted editor and its selector', async ({ page }) => {
    // Decks tab is active on open; only the deck selector is mounted.
    await expect(page.locator('.list-type-tab[data-active="true"]:has-text("Decks")')).toBeVisible()
    await expect(page.locator('#deck-select')).toBeVisible()
    await expect(page.locator('#collection-select')).toHaveCount(0)

    await page.locator('.list-type-tab:has-text("Collections")').click()
    await expect(
      page.locator('.list-type-tab[data-active="true"]:has-text("Collections")'),
    ).toBeVisible()
    await expect(page.locator('#collection-select')).toBeVisible()
    await expect(page.locator('#deck-select')).toHaveCount(0)

    await page.locator('.list-type-tab:has-text("Wanted Lists")').click()
    await expect(
      page.locator('.list-type-tab[data-active="true"]:has-text("Wanted Lists")'),
    ).toBeVisible()
    await expect(page.locator('#wanted-list-select')).toBeVisible()
    await expect(page.locator('#collection-select')).toHaveCount(0)
    await expect(page.locator('#deck-select')).toHaveCount(0)
  })
})
