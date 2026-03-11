import { test, expect } from '@playwright/test'

test.describe('Collection Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the Red Binder collection
    await page.goto('#/collections')
    await page.waitForSelector('.deck-cover', { timeout: 15_000 })
    await page.locator('a[href^="#/collection/"]').first().click()
    await page.waitForSelector('.section-divider', { timeout: 10_000 })
  })

  test('collection name is displayed as heading', async ({ page }) => {
    const heading = page.locator('h1, h2').first()
    await expect(heading).toBeVisible()
    await expect(heading).not.toBeEmpty()
  })

  test('collection entries are shown as card items', async ({ page }) => {
    const entries = page.locator('.card-item')
    await expect(entries.first()).toBeVisible()
    expect(await entries.count()).toBeGreaterThan(0)
  })

  test('collection shows card count', async ({ page }) => {
    const bodyText = await page.textContent('body')
    expect(bodyText).toMatch(/\d+\s*cards?/i)
  })

  test('collection shows price information', async ({ page }) => {
    // Should show some price, indicated by $ or similar
    const bodyText = await page.textContent('body')
    expect(bodyText).toMatch(/\$[\d.]+|€[\d.]+|\d+\.\d+\s*tix/i)
  })
})
