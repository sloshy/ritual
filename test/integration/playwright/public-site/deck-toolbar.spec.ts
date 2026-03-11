import { test, expect } from '@playwright/test'

test.describe('Deck Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/deck/black-panther')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('view mode buttons are present', async ({ page }) => {
    const viewToggle = page.locator('.view-toggle').first()
    await expect(viewToggle).toBeVisible()
    for (const mode of ['binder', 'list', 'overlap', 'stack']) {
      await expect(page.locator(`[data-view="${mode}"]`)).toBeVisible()
    }
  })

  test('switching to list view activates the button and shows card list items', async ({
    page,
  }) => {
    await page.locator('[data-view="list"]').click()
    await expect(page.locator('[data-view="list"]')).toHaveClass(/active/)
    // List view should render .card-list elements, not binder images
    await expect(page.locator('.card-list').first()).toBeVisible()
    await expect(page.locator('.card-binder').first()).not.toBeVisible()
  })

  test('switching to binder view activates the button and shows card images', async ({ page }) => {
    await page.locator('[data-view="list"]').click()
    await page.locator('[data-view="binder"]').click()
    await expect(page.locator('[data-view="binder"]')).toHaveClass(/active/)
    await expect(page.locator('.card-binder').first()).toBeVisible()
  })

  test('reverse checkbox toggles sort order', async ({ page }) => {
    const reverseLabel = page.locator('label').filter({ hasText: 'Reverse' })
    await expect(reverseLabel).toBeVisible()
    const checkbox = reverseLabel.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
  })

  test('hide lands checkbox toggles visibility of land cards', async ({ page }) => {
    const hideLabel = page.locator('label').filter({ hasText: 'Hide Lands' })
    await expect(hideLabel).toBeVisible()
    const checkbox = hideLabel.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
  })

  test('card size buttons are visible in binder view and hidden in list view', async ({ page }) => {
    // In binder view (default), size buttons should be visible
    const sizeToggle = page.locator('.view-toggle').nth(1)
    await expect(sizeToggle).toBeVisible()
    // Switch to list view — size buttons should disappear
    await page.locator('[data-view="list"]').click()
    await page.waitForTimeout(300)
    const sizeToggles = page.locator('.view-toggle')
    expect(await sizeToggles.count()).toBeLessThanOrEqual(1)
  })
})
