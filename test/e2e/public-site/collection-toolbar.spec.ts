import { test, expect } from '@playwright/test'
import { mockPublicSiteCollection } from '../helpers/mock-data'

test.describe('Collection Toolbar – Hide Unpriced', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollection(page)
    await page.goto('#/collection/test-collection')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
  })

  test('both priced and unpriced cards are visible by default', async ({ page }) => {
    const cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Priced Card')
    expect(cardNames).toContain('Unpriced Card')
  })

  test('Hide Unpriced toggle is present in the toolbar', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Hide Unpriced' })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  test('enabling Hide Unpriced removes unpriced cards and keeps priced cards', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Hide Unpriced' })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    const cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Priced Card')
    expect(cardNames).not.toContain('Unpriced Card')
  })

  test('disabling Hide Unpriced restores unpriced cards', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Hide Unpriced' })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    let cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).not.toContain('Unpriced Card')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Unpriced Card')
  })
})
