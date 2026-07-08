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

  test('switching to stack view activates the button and shows stacked card images', async ({
    page,
  }) => {
    await page.locator('[data-view="stack"]').click()
    await expect(page.locator('[data-view="stack"]')).toHaveClass(/active/)
    // Stack view shares the .card-overlap representation; it must be visible
    // (regression guard: the .view-stack CSS was once deleted, hiding all cards)
    await expect(page.locator('.card-overlap').first()).toBeVisible()
    await expect(page.locator('.card-binder').first()).not.toBeVisible()
  })

  test('reverse toggle reverses sort order', async ({ page }) => {
    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    // Grab card names within the first non-commander section before toggling
    const firstSection = page
      .locator('[data-section]')
      .filter({ hasNotText: /Commander/ })
      .first()
    const namesBefore = await firstSection.locator('.card-list .list-name').allTextContents()
    // The reverse control is joined to the (only) sort layer's dropdown.
    const reverseToggle = page.locator('.toolbar .toolbar-sort-reverse').first()
    await expect(reverseToggle).not.toHaveClass(/active/)
    await reverseToggle.click()
    await expect(reverseToggle).toHaveClass(/active/)
    // Cards within the section should appear in reversed order
    const namesAfter = await firstSection.locator('.card-list .list-name').allTextContents()
    expect(namesAfter).toEqual([...namesBefore].reverse())
  })

  test('add and remove sort layers, persisting to the URL', async ({ page }) => {
    const layers = page.locator('.toolbar-sort-layer')
    const addBtn = page.locator('.toolbar .toolbar-sort-add')

    // Starts as a single layer with no remove button (nothing to collapse to).
    await expect(layers).toHaveCount(1)
    await expect(page.locator('.toolbar .toolbar-sort-remove')).toHaveCount(0)

    // Adding a layer reveals a second dropdown and a remove button on each.
    await addBtn.click()
    await expect(layers).toHaveCount(2)
    await expect(page.locator('.toolbar .toolbar-sort-remove')).toHaveCount(2)

    // Make the second layer sort by price; the URL captures both layers in order.
    await layers.nth(1).locator('select').selectOption('price')
    await expect(page).toHaveURL(/sort=name(%2C|,)price/)

    // Removing the first (name) layer collapses to price as the primary sort.
    await layers.nth(0).locator('.toolbar-sort-remove').click()
    await expect(layers).toHaveCount(1)
    await expect(page.locator('.toolbar .toolbar-sort-remove')).toHaveCount(0)
    await expect(layers.nth(0).locator('select')).toHaveValue('price')
    await expect(page).toHaveURL(/sort=price/)
  })

  // Hide Lands now lives in the toolbar's Filters menu; it is covered
  // deterministically with synthetic data in filter-menu.spec.ts.

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

  test('Reverse Sections toggle reverses section order independently of card order', async ({
    page,
  }) => {
    // Switch to list view so section headers are visible
    await page.locator('[data-view="list"]').click()

    // Capture section labels before toggling (default group-by is 'type')
    const sectionsBefore = await page.locator('.section-divider').allTextContents()
    expect(sectionsBefore.length).toBeGreaterThan(1)

    const reverseSectionsToggle = page.locator('.toolbar button.toolbar-toggle', {
      hasText: /^↑↓ Reverse Sections$/,
    })
    await expect(reverseSectionsToggle).not.toHaveClass(/active/)
    await reverseSectionsToggle.click()
    await expect(reverseSectionsToggle).toHaveClass(/active/)

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
    const reverseSectionsToggle = page.locator('.toolbar button.toolbar-toggle', {
      hasText: /^↑↓ Reverse Sections$/,
    })
    await reverseSectionsToggle.click()

    const sectionsAfterReverseSections = await page.locator('.section-divider').allTextContents()
    expect(sectionsAfterReverseSections).toEqual([...sectionsBefore].reverse())

    const cardsAfterReverseSections = await creatureSection
      .locator('.card-list .list-name')
      .allTextContents()
    expect(cardsAfterReverseSections).toEqual(cardsBefore)

    // Also toggle Reverse (card sort) — section order stays reversed, card order within section reverses
    const reverseToggle = page.locator('.toolbar .toolbar-sort-reverse').first()
    await reverseToggle.click()

    const sectionsAfterBoth = await page.locator('.section-divider').allTextContents()
    expect(sectionsAfterBoth).toEqual([...sectionsBefore].reverse())

    const cardsAfterBoth = await creatureSection.locator('.card-list .list-name').allTextContents()
    expect(cardsAfterBoth).toEqual([...cardsBefore].reverse())
  })
})
