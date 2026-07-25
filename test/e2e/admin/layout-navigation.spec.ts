import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'

test.describe('Layout & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  // Desktop sidebar and dashboard-card navigation live in routing.spec.ts, which
  // covers the same clicks plus the URL they produce. What remains here is the
  // mobile overlay, which is Layout's own behavior.

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
