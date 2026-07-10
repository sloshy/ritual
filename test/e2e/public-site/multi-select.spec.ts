import { test, expect } from '@playwright/test'
import { gotoList, selectCard } from '../helpers/list-ui'
import { mockPublicSiteDeckForMultiSelect } from '../helpers/mock-public-site'

/**
 * Multi-select on the list pages: a per-card checkbox feeds a "Selected (N)"
 * toolbar menu whose actions (copy as text/CSV, add to trade) operate over the
 * whole selection. These tests drive the deck page (which shares the CardItem /
 * SelectionMenu wiring used by every list type) against a synthetic two-card
 * deck, and assert the state transitions: the count, view-switch persistence,
 * and trade hand-off.
 */
test.describe('List multi-select', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForMultiSelect(page)
    await gotoList(page, '#/deck/test-multi-select', '[data-view]')
  })

  test('selecting cards reveals the "Selected (N)" menu and counts up', async ({ page }) => {
    // The menu is absent until at least one card is selected.
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    const cards = page.locator('.card-item')
    await selectCard(page, 0)
    await expect(cards.nth(0).locator('.card-select-checkbox.selected')).toBeVisible()

    const btn = page.locator('.selection-menu-btn')
    await expect(btn).toHaveText(/Selected \(1\)/)

    await selectCard(page, 1)
    await expect(btn).toHaveText(/Selected \(2\)/)

    // Toggling the first card off (the checkbox is a toggle) decrements the count.
    await selectCard(page, 0)
    await expect(btn).toHaveText(/Selected \(1\)/)
  })

  test('ctrl/cmd-clicking a card selects it without opening the modal', async ({ page }) => {
    const first = page.locator('.card-item').nth(0)
    await first.locator('.card-binder').click({ modifiers: ['ControlOrMeta'] })

    await expect(first.locator('.card-select-checkbox.selected')).toBeVisible()
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(1\)/)
    // The modal stays mounted and is toggled via the backdrop's `open` class.
    await expect(page.locator('.card-modal')).not.toBeVisible()

    // A second ctrl/cmd-click toggles it back off.
    await first.locator('.card-binder').click({ modifiers: ['ControlOrMeta'] })
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
  })

  test('selection persists when switching to list view', async ({ page }) => {
    await selectCard(page, 0)
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(1\)/)

    await page.locator('[data-view="list"]').click()

    // Count is unchanged, and the far-left row checkbox reflects the selection.
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(1\)/)
    await expect(
      page.locator('.card-list .card-select-checkbox--list.selected').first(),
    ).toBeVisible()
  })

  test('Add to Trade hands the selected card to the trade board', async ({ page }) => {
    // The deck groups by type with Instant before Artifact, so the first card is
    // Lightning Bolt.
    await expect(page.locator('.card-item').nth(0)).toContainText('Lightning Bolt')
    await selectCard(page, 0)

    await page.locator('.selection-menu-btn').click()
    await page.locator('.selection-menu-item', { hasText: 'Add to Trade' }).click()

    await expect(page.locator('.trade-add-toast')).toBeVisible()
    // Adding clears the selection, so the menu disappears.
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    // Deck cards land on the left (offering) side of the trade, and it is the
    // card that was selected.
    await page.goto('#/trade')
    const leftRows = page.locator('.trade-col[data-side="left"] .trade-row-name-text')
    await expect(leftRows).toHaveCount(1)
    await expect(leftRows.first()).toContainText('Lightning Bolt')
  })
})
