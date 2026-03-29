import { test, expect } from '@playwright/test'

test.describe('Deck Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/deck/black-panther')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
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
    // Capture card order before toggling
    const cardsBefore = await page.locator('.section-divider').allTextContents()
    const reverseLabel = page.locator('label').filter({ hasText: 'Reverse' })
    const checkbox = reverseLabel.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    // Card sections should appear in reversed order
    const cardsAfter = await page.locator('.section-divider').allTextContents()
    expect(cardsAfter).toEqual([...cardsBefore].reverse())
  })

  test('hide lands checkbox hides land cards', async ({ page }) => {
    // Count section dividers before hiding lands
    const sectionsBefore = await page.locator('.section-divider').allTextContents()
    const hasLands = sectionsBefore.some((text) => /land/i.test(text))
    // Only test if lands section exists
    if (hasLands) {
      const hideLabel = page.locator('label').filter({ hasText: 'Hide Lands' })
      const checkbox = hideLabel.locator('input[type="checkbox"]')
      await checkbox.click()
      await expect(checkbox).toBeChecked()
      // Lands section should no longer appear
      const sectionsAfter = await page.locator('.section-divider').allTextContents()
      expect(sectionsAfter.some((text) => /land/i.test(text))).toBe(false)
      expect(sectionsAfter.length).toBeLessThan(sectionsBefore.length)
    }
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
