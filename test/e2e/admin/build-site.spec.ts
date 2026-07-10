import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { mockBuildSiteApi } from '../helpers/mock-admin'

test.describe('Build Site Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Build Site")').click()
    await expect(page.locator('.section-heading')).toContainText('Build Site')
  })

  test('clicking build shows success message', async ({ page }) => {
    await mockBuildSiteApi(page)
    const main = page.locator('main')
    await main.locator('.btn-primary').click()
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 10_000 })
  })
})
