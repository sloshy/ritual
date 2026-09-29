import { test, expect } from '@playwright/test'

test.describe('Header price-store picker', () => {
  test('the picked store persists when navigating to a deck page', async ({ page }) => {
    await page.goto('/')
    const picker = page.locator('#price-store')
    // The synthetic workspace offers TCGplayer and Cardmarket and opens on the
    // first, since it configures no defaultPriceSource.
    await expect(picker).toHaveValue('tcgplayer')
    await picker.selectOption('cardmarket')
    await page.locator('a[href^="#/deck/"]').first().click()
    await expect(page.locator('#price-store')).toHaveValue('cardmarket')
    await expect(page.locator('.page-stats')).toContainText('€')
  })
})
