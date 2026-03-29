import { test, expect } from '@playwright/test'

test.describe('Currency Selector', () => {
  test('switching to EUR updates currency', async ({ page }) => {
    await page.goto('/')
    const currencySelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="usd"]') })
    // Verify default is USD before switching
    await expect(currencySelect).toHaveValue('usd')
    await currencySelect.selectOption('eur')
    await expect(currencySelect).toHaveValue('eur')
  })

  test('currency persists when navigating to deck page', async ({ page }) => {
    await page.goto('/')
    const currencySelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="usd"]') })
    await currencySelect.selectOption('eur')
    // Navigate to a deck
    await page.locator('a[href^="#/deck/"]').first().click()
    await page.waitForTimeout(1000)
    // Currency should still be EUR
    const deckCurrencySelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="usd"]') })
    await expect(deckCurrencySelect).toHaveValue('eur')
  })
})
