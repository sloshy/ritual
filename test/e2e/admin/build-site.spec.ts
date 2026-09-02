import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import {
  emitStreamConnectionError,
  emitStreamEvent,
  mockBuildSiteApi,
  streamUrl,
} from '../helpers/mock-admin'

test.describe('Build Site Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Build Site")').click()
    await expect(page.locator('.section-heading')).toContainText('Build Site')
  })

  test('a streamed build shows its steps and output, then the success alert', async ({ page }) => {
    await mockBuildSiteApi(page)
    const main = page.locator('main')
    await main.locator('.btn-primary').click()

    // The page opens the stream and disables the button for the run's duration.
    expect(await streamUrl(page)).toContain('/api/build-site/stream')
    await expect(main.locator('.btn-primary')).toBeDisabled()
    await expect(main.locator('.progress-label')).toContainText('Starting the build')

    await emitStreamEvent(page, 'progress', {
      kind: 'step',
      progress: 1,
      total: 3,
      message: 'Building…',
    })
    await expect(main.locator('.progress-label')).toContainText('Building the site')

    // The child's own lines land in the log box as they arrive.
    await emitStreamEvent(page, 'progress', { kind: 'output', line: 'Rendering 3 decks' })
    await emitStreamEvent(page, 'progress', { kind: 'output', line: 'Writing index.html' })
    const log = main.locator('[data-testid="build-output"]')
    await expect(log).toContainText('Rendering 3 decks')
    await expect(log).toContainText('Writing index.html')

    await emitStreamEvent(page, 'progress', {
      kind: 'step',
      progress: 2,
      total: 3,
      message: 'Publishing to dist/…',
    })
    await expect(main.locator('.progress-label')).toContainText('Publishing to dist/')

    // A non-English `message` beside the real key: the alert must render the
    // key through the catalog, not echo whatever prose the server sent.
    await emitStreamEvent(page, 'done', {
      message: 'Website erstellt',
      messageKey: 'admin.api.buildSite.built',
      outDir: '/tmp/ritual-e2e/dist',
      durationMs: 1234,
    })
    await expect(main.locator('.alert-success')).toContainText('Site built successfully')
    await expect(main.locator('.progress-label')).toContainText('Site published')
    await expect(main.locator('.btn-primary')).toBeEnabled()
  })

  test('a failed build ends on the error frame’s reason', async ({ page }) => {
    await mockBuildSiteApi(page)
    const main = page.locator('main')
    await main.locator('.btn-primary').click()

    await emitStreamEvent(page, 'error', { message: 'Site build failed (exit 1). boom' })
    await expect(main.locator('.alert-error')).toContainText('exit 1')
    await expect(main.locator('.btn-primary')).toBeEnabled()
  })

  test('a stream that never connects falls back to the plain request', async ({ page }) => {
    const mocks = await mockBuildSiteApi(page)
    const main = page.locator('main')
    await main.locator('.btn-primary').click()

    // A connection-level failure before any frame: the build was never started
    // over the stream, so the page issues it over POST instead — exactly once.
    await emitStreamConnectionError(page)
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 10_000 })
    await expect(main.locator('.alert-error')).toHaveCount(0)
    expect(mocks.postedBuilds()).toBe(1)
    await expect(main.locator('.btn-primary')).toBeEnabled()
  })
})
