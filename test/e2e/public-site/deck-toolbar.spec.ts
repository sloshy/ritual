import { test, expect } from '@playwright/test'
import {
  mockPublicSiteDeckWithMultipleSections,
  mockPublicSiteDeckWithSidewaysCard,
} from '../helpers/mock-public-site'

test.describe('Deck Toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
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
    // In binder view (default) the size buttons render as a second .view-toggle group.
    await expect(page.locator('.view-toggle')).toHaveCount(2)
    // List view has no card images to size, so switching removes the size group.
    await page.locator('[data-view="list"]').click()
    await expect(page.locator('.view-toggle')).toHaveCount(1)
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

test.describe('Deck list view tooltip', () => {
  test('hovering a card row shows the image tooltip', async ({ page }) => {
    // Uses the sideways-card deck because its cards carry image URLs (served from
    // a routed local SVG) — the list tooltip only appears for cards that have a
    // resolvable front image, and the multi-section fixture has none.
    await mockPublicSiteDeckWithSidewaysCard(page)
    await page.goto('#/deck/test-sideways-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    await page.locator('[data-view="list"]').click()
    const row = page.locator('.card-list').first()
    await expect(row).toBeVisible()
    await row.hover()
    await expect(page.locator('.list-tooltip.visible')).toBeVisible()
  })
})
