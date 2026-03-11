import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockConfigApi, mockTotpApi, MOCK_CONFIG } from '../helpers/mock-data'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigApi(page)
    await mockTotpApi(page)
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
  })

  test('directory path inputs are pre-populated from config', async ({ page }) => {
    const main = page.locator('main')
    await expect(
      main.locator('input[name="decksDir"], input[placeholder*="decks" i]').first(),
    ).toHaveValue(MOCK_CONFIG.decksDir)
    await expect(
      main.locator('input[name="collectionsDir"], input[placeholder*="collection" i]').first(),
    ).toHaveValue(MOCK_CONFIG.collectionsDir)
  })

  test('save button triggers API call and shows success', async ({ page }) => {
    const main = page.locator('main')
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/config') && resp.request().method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    await responsePromise
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  })
})
