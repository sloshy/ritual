import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'

test.describe('Layout & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  // Desktop sidebar and dashboard-card navigation live in routing.spec.ts, which
  // covers the same clicks plus the URL they produce. What remains here is the
  // mobile overlay and the nav's own labelling, both Layout's own behavior.

  test('a page is titled exactly as the nav item and dashboard card that open it', async ({
    page,
  }) => {
    // Name and icon come from one table, so these three cannot drift apart —
    // Change History's heading was once missing the icon its nav item had.
    for (const label of ['Change History', 'Move Cards', 'Build Site']) {
      const navItem = page.locator(`.admin-sidebar .admin-nav-item:has-text("${label}")`)
      const icon = await navItem.locator('.nav-icon').textContent()
      expect(icon?.trim()).toBeTruthy()

      await navItem.click()
      await expect(page.locator('.section-heading')).toHaveText(`${icon} ${label}`)

      // The dashboard card for the same page carries the same name and icon.
      await page.locator('.admin-sidebar .admin-nav-item:has-text("Dashboard")').click()
      const card = page.locator('.admin-card').filter({ hasText: label })
      await expect(card.locator('.admin-card-icon')).toHaveText(icon!)
      await expect(card.locator('.admin-card-title')).toHaveText(label)
    }
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
