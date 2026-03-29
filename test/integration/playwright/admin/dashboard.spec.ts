import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('clicking Build Site card navigates to build page', async ({ page }) => {
    await page.locator('.admin-card:has-text("Build Site")').click()
    await expect(page.locator('.section-heading')).toContainText('Build Site')
  })

  test('clicking Settings card navigates to settings page', async ({ page }) => {
    await page.locator('.admin-card:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
  })
})
