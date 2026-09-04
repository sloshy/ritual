import { test, expect } from '@playwright/test'
import {
  mockPublicSiteDeckForFilters,
  mockPublicSiteDeckWithMultipleSections,
  mockPublicSiteDeckWithSidewaysCard,
} from '../helpers/mock-public-site'

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
    await expect(page.locator('.card-modal')).not.toBeVisible({ timeout: 3000 })

    // Open a different card → it must land on the details view, not the stale printings view.
    await cards.nth(1).locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.modal-printings-view')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Other Printings/ })).toBeVisible()
  })

  test('prices a foil-only printing at its foil price, not a nonfoil one it lacks', async ({
    page,
  }) => {
    await page.locator('.card-item').filter({ hasText: 'Test Creature' }).first().click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: /Other Printings/ }).click()

    const foilOnly = page.locator('.modal-printing-card').filter({ hasText: 'FYL:77' })
    await expect(foilOnly.locator('.printing-label-price')).toHaveText('$12.00')
  })

  // The modal keeps its content mounted while it fades out, so the panel has
  // something to animate rather than emptying mid-flight. That hold runs on a
  // timer, so what's worth pinning is that it always ends: were it to stick, the
  // modal's markup would stay in the DOM and leak into page-wide queries.
  test('closing tears the modal content down once the fade-out ends', async ({ page }) => {
    await page.locator('.card-item').first().locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    // `.card-modal` is the panel itself and always exists, so assert on content
    // rendered inside it — that is what the mount gate controls.
    const body = page.locator('.card-modal-details')
    await expect(body).toBeVisible()

    await page.locator('.modal-close').click()
    // Auto-retries past the exit animation; the content must leave the DOM, not
    // merely stop being visible.
    await expect(body).toHaveCount(0)
  })
})

test.describe('Card detail modal — tags', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('Tags button reveals the current printing oracle and art tags', async ({ page }) => {
    // White Knight is built with oracle tags "removal"/"mana-rock" and art tag "human".
    await page.locator('.card-item[data-name="white knight"] .card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })

    // Tags are hidden until the button is pressed.
    await expect(page.locator('.modal-tags')).toHaveCount(0)
    await page.getByRole('button', { name: /^Scryfall Tags/ }).click()

    const tags = page.locator('.modal-tags')
    await expect(tags).toBeVisible()
    await expect(tags.getByText('Oracle Tags')).toBeVisible()
    // Tags render as their raw Scryfall slugs — lowercase, hyphens preserved,
    // never title-cased ("mana-rock", not "Mana Rock").
    await expect(tags.locator('.modal-tag').filter({ hasText: /^removal$/ })).toBeVisible()
    await expect(tags.locator('.modal-tag').filter({ hasText: /^mana-rock$/ })).toBeVisible()
    await expect(tags.getByText('Art Tags')).toBeVisible()
    await expect(tags.locator('.modal-tag').filter({ hasText: /^human$/ })).toBeVisible()

    // The warning must not appear for a card the site was built with.
    await expect(page.locator('.modal-tags-warning')).toHaveCount(0)
  })

  test('a card with no tag data shows the incomplete-cache warning', async ({ page }) => {
    // Test Forest carries neither oracleTags nor artTags.
    await page.locator('.card-item[data-name="test forest"] .card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: /^Scryfall Tags/ }).click()
    await expect(page.locator('.modal-tags-warning')).toBeVisible()
    await expect(page.locator('.modal-tags-warning')).toContainText(/cache is incomplete/i)
    await expect(page.locator('.modal-tags')).toHaveCount(0)
  })
})

test.describe('Card detail modal — sideways cards', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithSidewaysCard(page)
    await page.goto('#/deck/test-sideways-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('a sideways card gets the landscape image panel and stays within it', async ({ page }) => {
    // Upright card: normal (portrait) panel, no sideways layout.
    await page.locator('.card-item[data-name="test creature"] .card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.card-modal-image')).not.toHaveClass(/sideways/)
    await page.locator('.modal-close').click()
    await expect(page.locator('.card-modal')).not.toBeVisible({ timeout: 3000 })

    // Sideways card (Battle): the image panel switches to the landscape layout.
    await page.locator('.card-item[data-name="test battle"] .card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    const imagePanel = page.locator('.card-modal-image')
    await expect(imagePanel).toHaveClass(/sideways/)

    const sidewaysImg = page.locator('.card-modal-image img.sideways')
    await expect(sidewaysImg).toBeVisible()

    // The rotated image must not spill out of its panel into the details column —
    // its visual right edge stays within the image panel's right edge.
    const imgBox = await sidewaysImg.boundingBox()
    const panelBox = await imagePanel.boundingBox()
    const detailsBox = await page.locator('.card-modal-details').boundingBox()
    expect(imgBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    expect(detailsBox).not.toBeNull()
    // Drawn (rotated) image is wider than tall — confirms it reads landscape.
    expect(imgBox!.width).toBeGreaterThan(imgBox!.height)
    // Right edge contained by the panel, which sits left of the details column.
    expect(imgBox!.x + imgBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(detailsBox!.x + 1)
  })
})
