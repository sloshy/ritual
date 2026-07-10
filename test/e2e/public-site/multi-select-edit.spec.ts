import { test, expect } from '@playwright/test'
import { enterEditMode, openSelectionMenu, selectCard } from '../helpers/list-ui'
import { mockPublicSiteDeckWithMultipleSections } from '../helpers/mock-public-site'

/**
 * Bulk edit actions on the multi-select menu, available only while a list is open
 * in edit mode. Driven against the public deck editor (which shares the
 * SelectionMenu / controller wiring with the admin editor and the flat lists),
 * asserting the state transitions each action produces in the editor's pending
 * changes — add/remove copies, full removal, move to section, and commander.
 */

test.describe('Multi-select bulk edit actions', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await enterEditMode(page, '#/deck/test-multi-section-deck')
    // Wait for the edit action bar too, so tests drive a fully mounted editor.
    await expect(page.locator('.btn-add')).toBeVisible()
  })

  test('the edit actions appear only in edit mode', async ({ page }) => {
    await selectCard(page, 0)
    const panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Add a copy' })).toBeVisible()
    // This deck holds a single copy of the card (a common commander-deck case), so
    // "Remove a copy" would duplicate "Remove from list" and is hidden.
    await expect(panel.locator('.selection-menu-item', { hasText: 'Remove a copy' })).toHaveCount(0)
    await expect(
      panel.locator('.selection-menu-item', { hasText: 'Remove from list' }),
    ).toBeVisible()
    await expect(
      panel.locator('.selection-menu-item', { hasText: 'Change Printing' }),
    ).toBeVisible()
    // Decks expose the commander action; sections come from the deck's own sections.
    await expect(
      panel.locator('.selection-menu-item', { hasText: 'Set as Commander' }),
    ).toBeVisible()
    await expect(
      panel.locator('.selection-menu-item', { hasText: 'Move to section…' }),
    ).toBeVisible()
  })

  test('Add a copy bumps each selected card by one, then clears the selection', async ({
    page,
  }) => {
    await selectCard(page, 0)
    await selectCard(page, 1)
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(2\)/)

    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Add a copy' }).click()

    // One add per selected card → two pending changes; selection cleared.
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
    // Both bumped tiles now show a 2× quantity badge.
    await expect(page.locator('.card-item .qty-badge', { hasText: '2x' })).toHaveCount(2)
  })

  test('Remove from list deletes every selected card', async ({ page }) => {
    const before = await page.locator('.card-item').count()
    await selectCard(page, 0)
    await selectCard(page, 1)

    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Remove from list' }).click()

    await expect(page.locator('.card-item')).toHaveCount(before - 2)
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
  })

  test('Move to a new section registers the create + move and clears the selection', async ({
    page,
  }) => {
    await selectCard(page, 0)
    const panel = await openSelectionMenu(page)
    await panel.locator('.selection-menu-item', { hasText: 'Move to section…' }).click()
    // The picker lists existing sections alongside the "New section…" entry.
    await expect(page.locator('.move-picker-item', { hasText: 'Main' })).toBeVisible()
    await page.locator('.move-picker-item', { hasText: 'New section…' }).click()

    // The in-app prompt replaces window.prompt for section naming.
    const input = page.locator('#text-prompt-input')
    await expect(input).toBeVisible()
    await input.fill('Sideboard')
    await page.locator('.confirm-dialog-actions button', { hasText: 'Move' }).click()

    // Moving into a brand-new section registers two pending changes (create the
    // section + move the card) and clears the selection — same as the per-card flow.
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
  })
})
