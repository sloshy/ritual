import { test, expect } from '@playwright/test'
import { mockPublicSiteMultiSelectLists } from '../helpers/mock-data'

/**
 * Cross-list selection: selections are held globally, so they survive navigating
 * to another list. A navbar "All Selected (N)" button then appears (because cards
 * are selected on a different list) and acts on the whole selection. Also covers
 * the name-only printing prompt during a bulk "Add to Trade".
 */
test.describe('Cross-list multi-select', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteMultiSelectLists(page)
  })

  test('navbar all-lists button is always visible and persists across navigation', async ({
    page,
  }) => {
    await page.goto('#/deck/ms-a')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // Selecting a card shows the navbar button immediately — even though the only
    // selection is on the list currently in view.
    await page
      .locator('.card-item')
      .nth(0)
      .locator('.card-binder')
      .click({
        modifiers: ['ControlOrMeta'],
      })
    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveText(/Selected \(1\)/)
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveText(/All Selected \(1\)/)

    // The navbar button persists on a non-list page (the index has no toolbar).
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveText(/All Selected \(1\)/)
    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveCount(0)

    // Navigate to deck B within the SPA (no reload, so the selection persists).
    await page.evaluate(() => {
      window.location.hash = '#/deck/ms-b'
    })
    await expect(page.locator('.page-title')).toHaveText('MS Deck B')
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveText(/All Selected \(1\)/)

    // Selecting a card on B raises the cross-list total to 2; the toolbar still
    // shows just B's count.
    await page
      .locator('.card-item')
      .nth(0)
      .locator('.card-binder')
      .click({
        modifiers: ['ControlOrMeta'],
      })
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveText(/All Selected \(2\)/)
    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveText(/Selected \(1\)/)

    // Clear all selections from the navbar menu wipes both lists.
    await page.locator('.selection-menu-btn--navbar').click()
    await page.locator('.selection-menu-item', { hasText: 'Clear all selections' }).click()
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveCount(0)
    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveCount(0)
  })

  test('the All Selected menu opens a modal to view, regroup, remove, and clear', async ({
    page,
  }) => {
    await page.goto('#/deck/ms-a')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // Select both cards on deck A.
    await page
      .locator('.card-item')
      .nth(0)
      .locator('.card-binder')
      .click({
        modifiers: ['ControlOrMeta'],
      })
    await page
      .locator('.card-item')
      .nth(1)
      .locator('.card-binder')
      .click({
        modifiers: ['ControlOrMeta'],
      })

    // Select the card on deck B too (cross-list total = 3).
    await page.evaluate(() => {
      window.location.hash = '#/deck/ms-b'
    })
    await expect(page.locator('.page-title')).toHaveText('MS Deck B')
    await page
      .locator('.card-item')
      .nth(0)
      .locator('.card-binder')
      .click({
        modifiers: ['ControlOrMeta'],
      })

    // Open the "view all selections" modal from the navbar menu.
    await page.locator('.selection-menu-btn--navbar').click()
    await page.locator('.selection-menu-item', { hasText: 'View all selections' }).click()

    const modal = page.locator('.selection-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.selection-modal-title')).toContainText('Selected Cards (3)')
    await expect(modal.locator('.selection-modal-row')).toHaveCount(3)
    // Selection-order mode shows each card's source.
    await expect(modal.locator('.selection-modal-row-source').first()).toContainText(
      'Deck · MS Deck A',
    )

    // The foil + condition of the Sol Ring copy are shown alongside its printing.
    await expect(modal).toContainText('C19:221 · Foil · LP')

    // Hovering a row shows the card-art preview, like the list view on a list page.
    await modal.locator('.selection-modal-row').first().hover()
    await expect(page.locator('.selection-modal-tooltip.visible')).toBeVisible({ timeout: 2000 })
    // Moving off the rows hides it again.
    await modal.locator('.selection-modal-title').hover()
    await expect(page.locator('.selection-modal-tooltip.visible')).toHaveCount(0)

    // Grouping by source produces one header per list.
    await modal.locator('.view-toggle button', { hasText: 'By source' }).click()
    await expect(modal.locator('.selection-modal-group-header')).toHaveCount(2)
    await expect(modal.locator('.selection-modal-group-header').first()).toContainText('MS Deck A')

    // Removing a single card drops the count.
    await modal.locator('.selection-modal-row-remove').first().click()
    await expect(modal.locator('.selection-modal-row')).toHaveCount(2)
    await expect(modal.locator('.selection-modal-title')).toContainText('Selected Cards (2)')

    // The copy action reports a status (clipboard content isn't asserted).
    await modal.locator('button', { hasText: 'Copy as Text' }).click()
    await expect(modal.locator('.selection-modal-status')).toBeVisible()

    // Clearing from the modal closes it and removes the navbar button.
    await modal.locator('button', { hasText: 'Clear all selections' }).click()
    await expect(page.locator('.selection-modal')).toHaveCount(0)
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveCount(0)
  })

  test('a quantity group selects every copy and supports per-copy removal', async ({ page }) => {
    await page.goto('#/deck/ms-qty')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    const card = page.locator('.card-item').first()
    await expect(card).toContainText('Lightning Bolt')

    // Selecting the 4× group selects all four copies; the count reflects individuals.
    await card.locator('.card-binder').click({ modifiers: ['ControlOrMeta'] })
    await expect(card.locator('.card-select-checkbox.selected')).toBeVisible()
    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveText(/Selected \(4\)/)

    // Open the modal: one row showing the group of four.
    await page.locator('.selection-menu-btn--navbar').click()
    await page.locator('.selection-menu-item', { hasText: 'View all selections' }).click()
    const modal = page.locator('.selection-modal')
    await expect(modal.locator('.selection-modal-row')).toHaveCount(1)
    await expect(modal.locator('.selection-modal-row-qty')).toHaveText('4×')

    // Removing one copy drops the count to three.
    await modal.locator('.selection-modal-row-remove').click()
    await expect(modal.locator('.selection-modal-row-qty')).toHaveText('3×')
    await expect(modal.locator('.selection-modal-title')).toContainText('Selected Cards (3)')

    // Back on the card, the now-partial group shows the dash state, not a full check.
    await page.keyboard.press('Escape')
    await expect(card.locator('.card-select-checkbox.partial')).toBeVisible()
    await expect(card.locator('.card-select-checkbox.selected')).toHaveCount(0)
  })

  test('bulk Add to Trade prompts for a printing on a name-only card', async ({ page }) => {
    await page.goto('#/deck/ms-b')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    const card = page.locator('.card-item').nth(0)
    await expect(card).toContainText('Mana Crypt')
    await card.locator('.card-binder').click({ modifiers: ['ControlOrMeta'] })

    await page.locator('.toolbar .selection-menu-btn').click()
    await page.locator('.selection-menu-item', { hasText: 'Add to Trade' }).click()

    // The name-only card has no pinned printing, so the picker opens for it.
    const picker = page.locator('.trade-picker-modal')
    await expect(picker).toBeVisible()
    await expect(page.locator('.trade-picker-title')).toContainText('Mana Crypt')
    await picker.locator('.trade-picker-item').first().click()
    await picker.locator('button', { hasText: 'Add to Trade' }).click()
    await expect(picker).not.toBeVisible()

    // The chosen printing landed on the offering side of the trade.
    await page.goto('#/trade')
    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
  })
})
