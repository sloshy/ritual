import { test, expect } from '@playwright/test'
import { mockPublicSiteCollection } from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'

test.describe('Collection Toolbar – Hide Unpriced', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollection(page)
    await page.goto('#/collection/test-collection')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
  })

  test('Hide Unpriced hides unpriced cards and restores them when disabled', async ({ page }) => {
    // Both priced and unpriced cards are visible by default.
    let cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Priced Card')
    expect(cardNames).toContain('Unpriced Card')

    // Enabling the toggle removes unpriced cards and keeps priced ones.
    await openFilterMenu(page)
    const toggle = page.getByRole('button', { name: 'Hide Unpriced' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Priced Card')
    expect(cardNames).not.toContain('Unpriced Card')

    // Disabling restores the unpriced cards.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Unpriced Card')
  })
})
