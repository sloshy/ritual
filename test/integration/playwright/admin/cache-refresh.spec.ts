import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockCacheRefreshApi } from '../helpers/mock-data'

test.describe('Cache Refresh Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Refresh Cache")').click()
    await expect(page.locator('.section-heading')).toContainText('Refresh Cache')
  })

  test('clicking refresh shows progress stages then completion', async ({ page }) => {
    await mockCacheRefreshApi(page)
    const main = page.locator('main')
    await main.locator('button:has-text("Refresh Cache")').click()
    await expect(main.locator('.progress-stages')).toBeVisible({ timeout: 5000 })
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 15_000 })
  })
})
