import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithMultipleSections } from '../helpers/mock-data'

test.describe('Card detail modal', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('reopening a different card starts on details, not the previous printings view', async ({
    page,
  }) => {
    const cards = page.locator('.card-item')

    // Open the first card → details view (no printings view yet).
    await cards.nth(0).locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.modal-printings-view')).toHaveCount(0)

    // Navigate into "Other Printings".
    await page.getByRole('button', { name: /Other Printings/ }).click()
    await expect(page.locator('.modal-printings-view')).toBeVisible()

    // Close the modal while still on the printings view.
    await page.locator('.modal-close').click()
    await expect(page.locator('.card-modal-backdrop.open')).not.toBeVisible({ timeout: 3000 })

    // Open a different card → it must land on the details view, not the stale printings view.
    await cards.nth(1).locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.modal-printings-view')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Other Printings/ })).toBeVisible()
  })
})
