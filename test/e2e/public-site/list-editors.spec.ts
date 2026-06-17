import { test, expect, type Page } from '@playwright/test'
import {
  mockPublicSiteCollection,
  mockPublicSiteCollectionWithDuplicates,
  mockPublicSiteWantedList,
} from '../helpers/mock-data'

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

async function selectFirstCard(page: Page): Promise<void> {
  const card = page.locator('.card-item').first()
  await card.locator('.card-binder').hover()
  await card.locator('.card-select-checkbox').click()
}

async function openSelectionMenu(page: Page) {
  await page.locator('.selection-menu-btn').click()
  return page.locator('.selection-menu-panel')
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

  test('"Remove a copy" stays hidden for single copies even with grouping on', async ({ page }) => {
    await page.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toBeVisible()

    // Ungrouped: each tile is one copy, so only whole-entry removal is offered.
    const groupToggle = page.locator('.toolbar-toggle', { hasText: 'Group Duplicates' })
    await expect(groupToggle).toHaveAttribute('aria-pressed', 'false')
    await selectFirstCard(page)
    let panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Add a copy' })).toBeVisible()
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
    await expect(
      panel.locator('.selection-menu-item', { hasText: 'Remove from list' }),
    ).toBeVisible()
    await panel.locator('.selection-menu-item', { hasText: 'Clear selection' }).click()
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    // This collection has no duplicate entries, so turning on "Group Duplicates" still
    // leaves every tile a single copy — "Remove a copy" remains hidden. The gate is the
    // actual group size, not the toggle.
    await groupToggle.click()
    await selectFirstCard(page)
    panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
  })
})

test.describe('Public collection editor — duplicate grouping', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithDuplicates(page)
    await page.goto('#/collection/dup-collection')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('"Remove a copy" appears once duplicates merge into a quantity group', async ({ page }) => {
    await page.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toBeVisible()

    // Ungrouped: the two copies are separate single-copy tiles, so no per-copy decrement.
    await selectFirstCard(page)
    let panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
    await panel.locator('.selection-menu-item', { hasText: 'Clear selection' }).click()
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    // Grouping the two identical copies makes one quantity-2 tile, so "Remove a copy"
    // (decrement to one) becomes a distinct, meaningful action.
    await page.locator('.toolbar-toggle', { hasText: 'Group Duplicates' }).click()
    await selectFirstCard(page)
    panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toBeVisible()
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

  test('"Remove a copy" is never offered (wanted entries are single)', async ({ page }) => {
    await page.locator('.btn-edit').click()
    await expect(page.locator('.edit-banner')).toBeVisible()

    await selectFirstCard(page)
    const panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Add a copy' })).toBeVisible()
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
  })
})
