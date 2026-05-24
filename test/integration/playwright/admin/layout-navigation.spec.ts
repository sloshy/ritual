import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

test.describe('Layout & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('sidebar nav items have expected labels', async ({ page }) => {
    const labels = [
      'Dashboard',
      'Edit Lists',
      'Manage Lists',
      'Import Deck',
      'Build Site',
      'Refresh Cache',
      'Archidekt Login',
      'Audit Log',
      'Settings',
    ]
    for (const label of labels) {
      await expect(
        page.locator(`.admin-sidebar .admin-nav-item:has-text("${label}")`),
      ).toBeVisible()
    }
  })

  test('clicking nav item changes page and active state', async ({ page }) => {
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
    const settingsNav = page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")')
    await expect(settingsNav).toHaveAttribute('data-active', 'true')
  })

  test('mobile hamburger menu opens sidebar overlay', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    // Desktop sidebar should not be visible
    await expect(page.locator('.admin-sidebar')).not.toBeVisible()
    // Click hamburger
    await page.locator('button[aria-label="Toggle menu"]').click()
    // Mobile nav should appear
    await expect(page.locator('.mobile-nav')).toBeVisible()
    await expect(page.locator('.mobile-backdrop')).toBeVisible()
  })

  test('clicking mobile backdrop closes sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.locator('button[aria-label="Toggle menu"]').click()
    await expect(page.locator('.mobile-nav')).toBeVisible()
    await page.locator('.mobile-backdrop').click({ force: true })
    await expect(page.locator('.mobile-nav')).not.toBeVisible()
  })

  test('mobile nav item click navigates and closes sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.locator('button[aria-label="Toggle menu"]').click()
    await page.locator('.mobile-nav .admin-nav-item:has-text("Build Site")').click()
    await expect(page.locator('.section-heading')).toContainText('Build Site')
    await expect(page.locator('.mobile-nav')).not.toBeVisible()
  })
})
