import { test, expect } from '@playwright/test'
import { enterEditMode, selectCard } from '../helpers/list-ui'
import { mockPublicSiteMultiSelectLists } from '../helpers/mock-public-site'

/**
 * Moving a card to another list while editing on the public site. The fixture has
 * three decks (ms-a, ms-b, ms-qty), so editing ms-a offers the others as move
 * destinations. Moves are ephemeral here (no server) — the card leaves the edited
 * view and is recorded as a pending change.
 */
test.describe('Move to list (public editor)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteMultiSelectLists(page)
    await enterEditMode(page, '#/deck/ms-a')
  })

  test('per-list Selected menu moves a card out of the edited list', async ({ page }) => {
    const before = await page.locator('.card-item').count()
    await selectCard(page, 0)

    await page.locator('.toolbar .selection-menu-btn').click()
    const panel = page.locator('.selection-menu-panel')
    // The single "Move to list…" item opens the destination picker.
    await panel.locator('.selection-menu-item', { hasText: 'Move to list…' }).click()

    const picker = page.locator('.move-picker-modal')
    await expect(picker.locator('.move-picker-title')).toHaveText('Move to list')
    // Match the full listRefLabel text (e.g. "Deck 'MS Deck B'"), so the exclusion
    // check below is exact rather than a bare-name substring match.
    // The other two decks are offered; the current list (MS Deck A) is not.
    await expect(picker.locator('.move-picker-item', { hasText: "Deck 'MS Deck A'" })).toHaveCount(
      0,
    )
    await picker.locator('.move-picker-item', { hasText: "Deck 'MS Deck B'" }).click()

    // The moved card leaves the edited view and the change is recorded.
    await expect(page.locator('.card-item')).toHaveCount(before - 1)
    await expect(page.locator('.changes-badge')).toHaveText('1')
  })

  test('dismissing the picker records no move', async ({ page }) => {
    const before = await page.locator('.card-item').count()
    await selectCard(page, 0)

    await page.locator('.toolbar .selection-menu-btn').click()
    await page
      .locator('.selection-menu-panel .selection-menu-item', { hasText: 'Move to list…' })
      .click()
    await expect(page.locator('.move-picker-modal')).toBeVisible()

    // Escape closes the picker without choosing a destination.
    await page.keyboard.press('Escape')
    await expect(page.locator('.move-picker-modal')).toHaveCount(0)
    await expect(page.locator('.card-item')).toHaveCount(before)
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('cross-list All Selected menu moves the active list’s card', async ({ page }) => {
    const before = await page.locator('.card-item').count()
    await selectCard(page, 0)

    await page.locator('.selection-menu-btn--navbar').click()
    const panel = page.locator('.selection-menu-panel')
    await panel.locator('.selection-menu-item', { hasText: 'Move all to list…' }).click()

    const picker = page.locator('.move-picker-modal')
    await picker.locator('.move-picker-item', { hasText: "Deck 'MS Deck B'" }).click()

    // The selected card (Lightning Bolt, the first tile) is the one that leaves.
    await expect(page.locator('.card-item')).toHaveCount(before - 1)
    await expect(page.locator('.card-item').first()).not.toContainText('Lightning Bolt')
    await expect(page.locator('.changes-badge')).toHaveText('1')
  })
})
