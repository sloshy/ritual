import { test, expect, type Page } from '@playwright/test'
import { enterEditMode, gotoList } from '../helpers/list-ui'
import { mockPublicSiteForFindPrintings } from '../helpers/mock-public-site'

/**
 * The "Find Other Printings" modal: every copy of one card across every list
 * (matched by front-face name, so the foil `Steam Vents // Steam Vents`
 * double-art counts), grouped by list with copies expanded side by side.
 * Covers every entry point (card modal, editor context menu, and the read-mode
 * ⋯ menu), the binder/list view toggle with foil sheen and hover preview, and
 * click-through navigation to the copy's list — cross-list and within the
 * current list.
 */

/** Open the modal for Steam Vents from the deck page's card detail modal. */
async function openFromCardModal(page: Page): Promise<void> {
  await page.locator('.card-item[data-name="steam vents"] .card-binder').click()
  await expect(page.locator('.card-modal')).toBeVisible()
  await page.locator('.card-modal').getByRole('button', { name: 'Find in Lists' }).click()
  await expect(page.locator('.find-printings-modal')).toBeVisible()
}

test.describe('Find Other Printings modal', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForFindPrintings(page)
    await gotoList(page, '#/deck/print-deck')
  })

  test('shows every copy grouped by list, expanded side by side, with foil sheen', async ({
    page,
  }) => {
    await openFromCardModal(page)
    const modal = page.locator('.find-printings-modal')

    // The card modal handed off to the lookup.
    await expect(page.locator('.card-modal')).not.toBeVisible()
    await expect(modal.locator('.find-printings-card-name')).toHaveText('Steam Vents')

    // 2 deck copies (one 2x line, expanded) + 2 binder copies; the wanted list
    // holds no Steam Vents so it contributes no group.
    await expect(modal.locator('.find-printings-summary')).toHaveText('4 copies across 2 lists')
    const groups = modal.locator('.find-printings-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.nth(0)).toContainText('Print Deck')
    await expect(groups.nth(0).locator('.card-item')).toHaveCount(2)
    await expect(groups.nth(1)).toContainText('Print Binder')
    await expect(groups.nth(1).locator('.card-item')).toHaveCount(2)

    // The deck currently in view is titled as such; the other list is not.
    await expect(groups.nth(0).locator('.find-printings-group-name')).toHaveText(
      'Current List — Print Deck',
    )
    await expect(groups.nth(1).locator('.find-printings-group-name')).toHaveText('Print Binder')

    // The binder's foil double-art copy renders with the foil sheen.
    await expect(groups.nth(1).locator('.card-binder.foil-card')).toHaveCount(1)
  })

  test('toggles to the list view with printing labels and hover preview', async ({ page }) => {
    await openFromCardModal(page)
    const modal = page.locator('.find-printings-modal')

    await modal.locator('.view-toggle button', { hasText: 'List' }).click()
    await expect(modal.locator('.find-printings-results')).toHaveClass(/view-list/)

    // Rows show the printing identity, and the foil copy keeps its sheen class.
    const binderGroup = modal.locator('.find-printings-group').nth(1)
    await expect(binderGroup.locator('.card-list .list-printing').first()).toHaveText(
      '(SLD:1234 · Foil · NM)',
    )
    await expect(binderGroup.locator('.card-list.foil-card')).toHaveCount(1)

    // Hovering a row raises the cursor-tracked art preview in the modal overlay.
    await binderGroup.locator('.card-list').first().hover()
    await expect(page.locator('.find-printings-tooltip')).toHaveClass(/visible/)

    // The chosen view persists across close/reopen within the session.
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await openFromCardModal(page)
    await expect(modal.locator('.find-printings-results')).toHaveClass(/view-list/)
  })

  test('the current list is pinned to the top of the results', async ({ page }) => {
    // Opened from the collection, whose lists load after the deck: it still leads.
    await gotoList(page, '#/collection/print-binder')
    await openFromCardModal(page)

    const names = page.locator('.find-printings-group .find-printings-group-name')
    await expect(names.nth(0)).toHaveText('Current List — Print Binder')
    await expect(names.nth(1)).toHaveText('Print Deck')
  })

  test('clicking a copy in another list navigates there and highlights it', async ({ page }) => {
    await openFromCardModal(page)

    // The binder's second copy (nonfoil gpt:233, cardId 2).
    await page
      .locator('.find-printings-group')
      .nth(1)
      .locator('.card-item[data-card-id="2"] .card-binder')
      .click()

    await expect(page.locator('.find-printings-modal')).not.toBeVisible()
    await expect(page).toHaveURL(/#\/collection\/print-binder$/)
    await expect(page.locator('.page-title')).toHaveText('Print Binder')
    // The landed-on copy gets the flash highlight.
    await expect(page.locator('.card-item[data-card-id="2"].card-nav-highlight')).toBeVisible()
  })

  test('clicking a copy in the current list just closes and highlights in place', async ({
    page,
  }) => {
    await openFromCardModal(page)

    await page
      .locator('.find-printings-group')
      .nth(0)
      .locator('.card-item .card-binder')
      .first()
      .click()

    await expect(page.locator('.find-printings-modal')).not.toBeVisible()
    await expect(page).toHaveURL(/#\/deck\/print-deck$/)
    await expect(page.locator('.card-item[data-card-id="1"].card-nav-highlight')).toBeVisible()
  })

  test('opens from the editor context menu via "Find in Lists"', async ({ page }) => {
    await enterEditMode(page)

    const tile = page.locator('.card-item[data-name="steam vents"]')
    await tile.locator('.card-binder').hover()
    await tile.locator('.edit-btn-context').click()

    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    // Edit mode keeps the edit actions alongside the lookup.
    await expect(
      menu.locator('.card-context-menu-item', { hasText: 'Change Printing' }),
    ).toBeVisible()
    await expect(
      menu.locator('.card-context-menu-item', { hasText: 'Move to section' }),
    ).toBeVisible()
    await menu.locator('.card-context-menu-item', { hasText: 'Find in Lists' }).click()

    const modal = page.locator('.find-printings-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.find-printings-summary')).toHaveText('4 copies across 2 lists')
  })

  test('the read-mode ⋯ menu offers only "Find in Lists"', async ({ page }) => {
    // No edit mode: the tile still offers the ⋯ menu, but without edit actions.
    const tile = page.locator('.card-item[data-name="steam vents"]')
    await tile.locator('.card-binder').hover()
    await expect(tile.locator('.edit-btn-increment')).toHaveCount(0)
    await tile.locator('.edit-btn-context').click()

    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    const items = menu.locator('.card-context-menu-item')
    await expect(items).toHaveCount(1)
    await expect(items).toHaveText('Find in Lists')

    await items.click()
    const modal = page.locator('.find-printings-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.find-printings-summary')).toHaveText('4 copies across 2 lists')
  })
})
