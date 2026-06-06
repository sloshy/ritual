import { test, expect, type Page } from '@playwright/test'
import { mockPublicSiteCollection, mockPublicSiteWantedList } from '../helpers/mock-data'

/**
 * The public collection and wanted-list editors share the flat-list editor with
 * the deck editor, so these cover the shared edit/toggle/discard/export flow for
 * the two flat list types.
 */

async function enterEditAndRemoveOne(page: Page): Promise<void> {
  await page.locator('.btn-edit').click()
  await expect(page.locator('.edit-banner')).toBeVisible()
  const firstCard = page.locator('.card-item').first()
  await firstCard.hover()
  await firstCard.locator('.edit-btn-decrement').click()
  await expect(page.locator('.changes-badge')).toHaveText('1')
}

test.describe('Public collection editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollection(page)
    await page.goto('#/collection/test-collection')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('edits, preserves edits across the original/edited toggle, and exports', async ({
    page,
  }) => {
    await enterEditAndRemoveOne(page)

    // Toggling to Original hides the editor; toggling back preserves the edit.
    await page.locator('.edit-banner-toggle-btn', { hasText: 'Original' }).click()
    await expect(page.locator('.btn-add')).toHaveCount(0)
    await page.locator('.edit-banner-toggle-btn', { hasText: 'Edited' }).click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Export panel offers the change-list JSON plus the .md and .csv files.
    await page.locator('.edit-banner .site-btn-export').click()
    await expect(page.locator('.export-panel')).toContainText('1 change')
    await expect(page.locator('.export-panel button', { hasText: 'Download CSV' })).toBeEnabled()
    await expect(
      page.locator('.export-panel button', { hasText: 'updated collection' }),
    ).toBeEnabled()
  })

  test('discard reverts pending changes', async ({ page }) => {
    await enterEditAndRemoveOne(page)
    await page.locator('.edit-banner button', { hasText: 'Discard' }).click()
    await page.locator('.discard-dialog-native .btn-discard').click()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })
})

test.describe('Public wanted-list editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteWantedList(page)
    await page.goto('#/wanted/test-wanted-list')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('edits a local copy and exports a change list', async ({ page }) => {
    await enterEditAndRemoveOne(page)

    await page.locator('.edit-banner .site-btn-export').click()
    await expect(page.locator('.export-panel')).toContainText('1 change')
    await expect(
      page.locator('.export-panel button', { hasText: 'Download change list' }),
    ).toBeEnabled()
    await expect(
      page.locator('.export-panel button', { hasText: 'updated wanted list' }),
    ).toBeEnabled()
  })
})
