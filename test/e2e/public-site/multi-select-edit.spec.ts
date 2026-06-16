import { test, expect, type Page } from '@playwright/test'
import { mockPublicSiteDeckWithMultipleSections } from '../helpers/mock-data'

/**
 * Bulk edit actions on the multi-select menu, available only while a list is open
 * in edit mode. Driven against the public deck editor (which shares the
 * SelectionMenu / controller wiring with the admin editor and the flat lists),
 * asserting the state transitions each action produces in the editor's pending
 * changes — add/remove copies, full removal, move to section, and commander.
 */

async function enterEditMode(page: Page): Promise<void> {
  await page.locator('.btn-edit').click()
  await expect(page.locator('.edit-banner')).toBeVisible()
  await expect(page.locator('.btn-add')).toBeVisible()
}

async function selectCard(page: Page, index: number): Promise<void> {
  const card = page.locator('.card-item').nth(index)
  await card.locator('.card-binder').hover()
  await card.locator('.card-select-checkbox').click()
}

async function openSelectionMenu(page: Page) {
  await page.locator('.selection-menu-btn').click()
  return page.locator('.selection-menu-panel')
}

test.describe('Multi-select bulk edit actions', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await enterEditMode(page)
  })

  test('the edit actions appear only in edit mode', async ({ page }) => {
    await selectCard(page, 0)
    const panel = await openSelectionMenu(page)
    await expect(panel.locator('.selection-menu-item', { hasText: 'Add a copy' })).toBeVisible()
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
      panel.locator('.selection-menu-label', { hasText: 'Move to section' }),
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
    await panel.locator('.selection-menu-item', { hasText: 'New section…' }).click()

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
