import { test, expect, type Page } from '@playwright/test'
import { enterEditMode, gotoList, openSelectionMenu, selectCard } from '../helpers/list-ui'
import {
  mockPublicSiteCollection,
  mockPublicSiteCollectionWithDuplicates,
  mockPublicSiteWantedList,
} from '../helpers/mock-public-site'

/**
 * The public collection and wanted-list editors share the flat-list editor with
 * the deck editor, so these cover the shared edit/toggle/discard/export flow for
 * the two flat list types.
 */

async function enterEditAndRemoveOne(page: Page): Promise<void> {
  await enterEditMode(page)
  const firstCard = page.locator('.card-item').first()
  await firstCard.hover()
  await firstCard.locator('.edit-btn-decrement').click()
  await expect(page.locator('.changes-badge')).toHaveText('1')
}

test.describe('Public collection editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollection(page)
    await gotoList(page, '#/collection/test-collection')
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
    await page.locator('.edit-banner .btn-export').click()
    await expect(page.locator('.export-panel')).toContainText('1 change')
    await expect(page.locator('.export-panel button', { hasText: 'Download CSV' })).toBeEnabled()
    await expect(
      page.locator('.export-panel button', { hasText: 'updated collection' }),
    ).toBeEnabled()
  })

  test('"Remove a copy" stays hidden for single copies even with grouping on', async ({ page }) => {
    await enterEditMode(page)

    // Ungrouped: each tile is one copy, so only whole-entry removal is offered.
    const groupToggle = page.locator('.toolbar-toggle', { hasText: 'Group Duplicates' })
    await expect(groupToggle).toHaveAttribute('aria-pressed', 'false')
    await selectCard(page, 0)
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
    await selectCard(page, 0)
    panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
  })
})

test.describe('Public collection editor — duplicate grouping', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithDuplicates(page)
    await gotoList(page, '#/collection/dup-collection')
  })

  test('"Remove a copy" appears once duplicates merge into a quantity group', async ({ page }) => {
    await enterEditMode(page)

    // Ungrouped: the two copies are separate single-copy tiles, so no per-copy decrement.
    await selectCard(page, 0)
    let panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
    await panel.locator('.selection-menu-item', { hasText: 'Clear selection' }).click()
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    // Grouping the two identical copies makes one quantity-2 tile, so "Remove a copy"
    // (decrement to one) becomes a distinct, meaningful action.
    await page.locator('.toolbar-toggle', { hasText: 'Group Duplicates' }).click()
    await selectCard(page, 0)
    panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toBeVisible()
  })
})

test.describe('Public wanted-list editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteWantedList(page)
    await gotoList(page, '#/wanted/test-wanted-list')
  })

  test('edits a local copy and exports a change list', async ({ page }) => {
    await enterEditAndRemoveOne(page)

    // The wanted page's selection menu is wired to the editor: it offers the
    // "Add a copy" edit action while a card is selected.
    await selectCard(page, 0)
    const panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Add a copy' })).toBeVisible()
    await panel.locator('.selection-menu-item', { hasText: 'Clear selection' }).click()
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    await page.locator('.edit-banner .btn-export').click()
    await expect(page.locator('.export-panel')).toContainText('1 change')
    await expect(
      page.locator('.export-panel button', { hasText: 'Download change list' }),
    ).toBeEnabled()
    await expect(
      page.locator('.export-panel button', { hasText: 'updated wanted list' }),
    ).toBeEnabled()
  })

  test('the printing row reads "Set Printing" only for a name-only entry', async ({ page }) => {
    await enterEditMode(page)

    // Name-only entries are the normal case on a wanted list, so this editor is
    // where the alternate label actually shows up.
    const menu = page.locator('.card-context-menu')
    const openMenu = async (name: string): Promise<void> => {
      const tile = page.locator(`.card-item[data-name="${name}"]`)
      await tile.hover()
      await tile.locator('.edit-btn-context').click()
      await expect(menu).toBeVisible()
    }

    await openMenu('lightning bolt')
    await expect(menu.locator('.card-context-menu-item', { hasText: 'Set Printing' })).toBeVisible()
    await expect(
      menu.locator('.card-context-menu-item', { hasText: 'Change Printing' }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Sol Ring pins C19:221, so the same row reads "Change Printing".
    await openMenu('sol ring')
    await expect(
      menu.locator('.card-context-menu-item', { hasText: 'Change Printing' }),
    ).toBeVisible()
    await expect(menu.locator('.card-context-menu-item', { hasText: 'Set Printing' })).toHaveCount(
      0,
    )
  })
})
