import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockImportDeckApi } from '../helpers/mock-data'

test.describe('Import Deck Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Import Deck")').click()
    await expect(page.locator('.section-heading')).toContainText('Import Deck')
  })

  test('successful import shows success message', async ({ page }) => {
    await mockImportDeckApi(page)
    const main = page.locator('main')
    // Verify button starts disabled (no URL), fill URL to enable, then import
    const button = main.locator('button:has-text("Import Deck")')
    await expect(button).toBeDisabled()
    await main.locator('input.form-input').fill('https://archidekt.com/decks/12345')
    await expect(button).toBeEnabled()
    await button.click()
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  })
})
