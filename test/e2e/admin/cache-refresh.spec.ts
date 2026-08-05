import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { mockCacheRefreshApi, emitStreamEvent, mockBuylistApi } from '../helpers/mock-admin'

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

    await emitStreamEvent(page, 'progress', {
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

    await emitStreamEvent(page, 'progress', {
      stage: 'save',
      message: 'Saving to cache...',
    })
    await expect(main.locator('.progress-stage[data-status="done"]')).toContainText(
      'Downloading & processing card data',
    )
    await expect(main.locator('.progress-stage[data-status="active"]')).toContainText(
      'Saving to cache',
    )

    await emitStreamEvent(page, 'done', { message: 'Cache refreshed successfully' })
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    // Completion collapses the progress UI and re-enables the button.
    await expect(main.locator('.progress-stages')).toHaveCount(0)
    await expect(main.locator('button:has-text("Refresh Cache")')).toBeEnabled()
  })
})

test.describe('Cache Refresh Page — Card Kingdom buylist', () => {
  // The card fetches its status on mount, so the route must be intercepted
  // before the page is opened — unlike the cache-refresh stream above, which is
  // only reached on click. Hence: land on the dashboard, install the mock, then
  // navigate to the page.
  const openCacheRefresh = async (page: Page): Promise<void> => {
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Refresh Cache")').click()
    await expect(page.locator('.section-heading')).toContainText('Refresh Cache')
  }

  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  test('the buylist card reports the cached feed and refreshes it on demand', async ({ page }) => {
    await mockBuylistApi(page)
    await openCacheRefresh(page)
    const card = page.locator('.cache-card')
    await expect(card).toContainText('Card Kingdom buylist')
    await expect(card.locator('.cache-card-facts')).toContainText('149,978')

    await card.locator('button:has-text("Refresh buylist")').click()
    await expect(card.locator('.cache-card-status')).toContainText('Buylist updated')
  })

  test('a workspace with no buylist yet shows an empty state, not an error', async ({ page }) => {
    await mockBuylistApi(page, 'missing')
    await openCacheRefresh(page)
    const card = page.locator('.cache-card')
    // The 503 is the normal first-run state: offer the button, don't alarm.
    await expect(card.locator('.cache-card-empty')).toContainText('No buylist has been downloaded')
    await expect(card.locator('.cache-card-error')).toHaveCount(0)
    await expect(card.locator('button:has-text("Refresh buylist")')).toBeEnabled()
  })
})
