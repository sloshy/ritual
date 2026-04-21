import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockAdminCollectionLoadApi, mockCollectionsApi } from '../helpers/mock-data'

test.describe('Collection Editor – Hide Unpriced', () => {
  test.beforeEach(async ({ page }) => {
    await mockCollectionsApi(page)
    await mockAdminCollectionLoadApi(page)

    await loginAsAdmin(page)
    await page.locator('.admin-nav-item:has-text("Collection Editor")').click()
    await expect(page.locator('.section-heading')).toContainText('Collection Editor')

    // Wait for the collection selector to be populated
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })

    // Select the test collection
    const select = page.locator('select#collection-select')
    await select.selectOption('test-collection')

    // Wait for card content to appear
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

  test('Hide Unpriced checkbox is present in the toolbar', async ({ page }) => {
    const hideUnpricedLabel = page.locator('label').filter({ hasText: 'Hide Unpriced' })
    await expect(hideUnpricedLabel).toBeVisible()
    const checkbox = hideUnpricedLabel.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
  })

  test('enabling Hide Unpriced removes unpriced cards and keeps priced cards', async ({ page }) => {
    const hideUnpricedLabel = page.locator('label').filter({ hasText: 'Hide Unpriced' })
    const checkbox = hideUnpricedLabel.locator('input[type="checkbox"]')

    await checkbox.click()
    await expect(checkbox).toBeChecked()

    const cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Priced Card')
    expect(cardNames).not.toContain('Unpriced Card')
  })

  test('disabling Hide Unpriced restores unpriced cards', async ({ page }) => {
    const hideUnpricedLabel = page.locator('label').filter({ hasText: 'Hide Unpriced' })
    const checkbox = hideUnpricedLabel.locator('input[type="checkbox"]')

    await checkbox.click()
    await expect(checkbox).toBeChecked()
    let cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).not.toContain('Unpriced Card')

    await checkbox.click()
    await expect(checkbox).not.toBeChecked()
    cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Unpriced Card')
  })
})
