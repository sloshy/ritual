import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithMultipleSections } from '../helpers/mock-data'

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
    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    // Grab card names within the first non-commander section before toggling
    const firstSection = page
      .locator('[data-section]')
      .filter({ hasNotText: /Commander/ })
      .first()
    const namesBefore = await firstSection.locator('.card-list .list-name').allTextContents()
    const reverseLabel = page.locator('label').filter({ hasText: /^Reverse$/ })
    const checkbox = reverseLabel.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    // Cards within the section should appear in reversed order
    const namesAfter = await firstSection.locator('.card-list .list-name').allTextContents()
    expect(namesAfter).toEqual([...namesBefore].reverse())
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

test.describe('Deck Toolbar – Reverse Sections', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('Reverse Sections checkbox reverses section order independently of card order', async ({
    page,
  }) => {
    // Switch to list view so section headers are visible
    await page.locator('[data-view="list"]').click()

    // Capture section labels before toggling (default group-by is 'type')
    const sectionsBefore = await page.locator('.section-divider').allTextContents()
    expect(sectionsBefore.length).toBeGreaterThan(1)

    const reverseSectionsLabel = page.locator('label').filter({ hasText: /^Reverse Sections$/ })
    const checkbox = reverseSectionsLabel.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()

    // Section order should now be reversed
    const sectionsAfter = await page.locator('.section-divider').allTextContents()
    expect(sectionsAfter).toEqual([...sectionsBefore].reverse())
  })

  test('Reverse Sections and Reverse operate independently', async ({ page }) => {
    await page.locator('[data-view="list"]').click()

    // Capture initial card order within the Creature section (sorted by name: 'Alpha Creature', 'Test Creature')
    const creatureSection = page.locator('[data-section="Creature"]')
    const cardsBefore = await creatureSection.locator('.card-list .list-name').allTextContents()
    expect(cardsBefore).toEqual(['Alpha Creature', 'Test Creature'])

    const sectionsBefore = await page.locator('.section-divider').allTextContents()

    // Toggle Reverse Sections only — section order reverses, intra-section card order unchanged
    const reverseSectionsCheckbox = page
      .locator('label')
      .filter({ hasText: /^Reverse Sections$/ })
      .locator('input[type="checkbox"]')
    await reverseSectionsCheckbox.click()

    const sectionsAfterReverseSections = await page.locator('.section-divider').allTextContents()
    expect(sectionsAfterReverseSections).toEqual([...sectionsBefore].reverse())

    const cardsAfterReverseSections = await creatureSection
      .locator('.card-list .list-name')
      .allTextContents()
    expect(cardsAfterReverseSections).toEqual(cardsBefore)

    // Also toggle Reverse (card sort) — section order stays reversed, card order within section reverses
    const reverseCheckbox = page
      .locator('label')
      .filter({ hasText: /^Reverse$/ })
      .locator('input[type="checkbox"]')
    await reverseCheckbox.click()

    const sectionsAfterBoth = await page.locator('.section-divider').allTextContents()
    expect(sectionsAfterBoth).toEqual([...sectionsBefore].reverse())

    const cardsAfterBoth = await creatureSection.locator('.card-list .list-name').allTextContents()
    expect(cardsAfterBoth).toEqual([...cardsBefore].reverse())
  })
})
