import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('displays all action cards with correct titles', async ({ page }) => {
    const expectedTitles = [
      'Deck Editor',
      'Collection Editor',
      'Import Deck',
      'Build Site',
      'Refresh Cache',
      'Archidekt Login',
      'Settings',
    ]
    await expect(page.locator('.admin-card')).toHaveCount(7)
    for (const title of expectedTitles) {
      await expect(page.locator(`.admin-card-title:has-text("${title}")`)).toBeVisible()
    }
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
