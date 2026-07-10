import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { mockCacheRefreshApi, emitCacheRefreshEvent } from '../helpers/mock-admin'

test.describe('Cache Refresh Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Refresh Cache")').click()
    await expect(page.locator('.section-heading')).toContainText('Refresh Cache')
  })

  test('clicking refresh shows progress stages then completion', async ({ page }) => {
    await mockCacheRefreshApi(page)
    const main = page.locator('main')
    await main.locator('button:has-text("Refresh Cache")').click()

    await emitCacheRefreshEvent(page, 'progress', {
      stage: 'download',
      percentage: 50,
      message: 'Downloading: 50% (36.25/72.50 MiB)',
    })
    await expect(main.locator('.progress-stages')).toBeVisible({ timeout: 5000 })
    // The streamed pipeline has exactly two stages: the download (which parses
    // and processes cards as bytes arrive) and the cache save.
    await expect(main.locator('.progress-stage')).toHaveCount(2)
    await expect(main.locator('.progress-stage[data-status="active"]')).toContainText(
      'Downloading & processing card data',
    )

    await emitCacheRefreshEvent(page, 'progress', {
      stage: 'save',
      message: 'Saving to cache...',
    })
    await expect(main.locator('.progress-stage[data-status="done"]')).toContainText(
      'Downloading & processing card data',
    )
    await expect(main.locator('.progress-stage[data-status="active"]')).toContainText(
      'Saving to cache',
    )

    await emitCacheRefreshEvent(page, 'done', { message: 'Cache refreshed successfully' })
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    // Completion collapses the progress UI and re-enables the button.
    await expect(main.locator('.progress-stages')).toHaveCount(0)
    await expect(main.locator('button:has-text("Refresh Cache")')).toBeEnabled()
  })
})
