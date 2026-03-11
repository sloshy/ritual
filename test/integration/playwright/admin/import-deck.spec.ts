import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockImportDeckApi } from '../helpers/mock-data'

test.describe('Import Deck Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Import Deck")').click()
    await expect(page.locator('.section-heading')).toContainText('Import Deck')
  })

  test('import button is disabled when input is empty', async ({ page }) => {
    const main = page.locator('main')
    const button = main.locator('button:has-text("Import Deck")')
    await expect(button).toBeDisabled()
  })

  test('import button enables when URL is entered', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('input.form-input').fill('https://archidekt.com/decks/12345')
    const button = main.locator('button:has-text("Import Deck")')
    await expect(button).toBeEnabled()
  })

  test('overwrite checkbox can be toggled', async ({ page }) => {
    const main = page.locator('main')
    const checkbox = main.locator('input[type="checkbox"]')
    await expect(checkbox).not.toBeChecked()
    await checkbox.click()
    await expect(checkbox).toBeChecked()
  })

  test('successful import shows success message', async ({ page }) => {
    await mockImportDeckApi(page)
    const main = page.locator('main')
    await main.locator('input.form-input').fill('https://archidekt.com/decks/12345')
    await main.locator('button:has-text("Import Deck")').click()
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  })
})
