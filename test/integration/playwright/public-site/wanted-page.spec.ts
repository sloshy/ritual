import { test, expect } from '@playwright/test'
import { mockPublicSiteWantedList } from '../helpers/mock-data'

test.describe('Wanted List Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteWantedList(page)
    await page.goto('#/wanted/test-wanted-list')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('displays entries in all three states', async ({ page }) => {
    const items = page.locator('.card-item')
    expect(await items.count()).toBe(3)
  })

  test('shows card count and price', async ({ page }) => {
    const bodyText = await page.textContent('body')
    expect(bodyText).toMatch(/3\s*cards?/i)
    expect(bodyText).toMatch(/\$[\d.]+/)
  })

  test('clicking a card opens the card detail modal', async ({ page }) => {
    await page.locator('.card-item').first().click()
    await expect(page.locator('.card-modal, [class*="modal"]').first()).toBeVisible({
      timeout: 5_000,
    })
  })
})
