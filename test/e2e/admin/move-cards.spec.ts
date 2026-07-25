import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { mockMoveCardsApi } from '../helpers/mock-admin'

type CommitBody = { moves: { cardKey: string; toType: string; toSlug: string }[] }

const BINDER_CARD_KEY = 'collection:move-binder:1:0'

/** Queue the binder's one card for a move into the deck, leaving it unsaved. */
async function queueBinderCardIntoDeck(page: Page): Promise<void> {
  await page.locator('#move-list-select').selectOption('collection:move-binder')
  const moveButton = page.locator('.edit-btn-move')
  await expect(moveButton).toHaveCount(1)
  await moveButton.first().click()
  const menu = page.locator('.move-destination-menu')
  await expect(menu).toBeVisible()
  await menu.locator('.card-context-menu-item', { hasText: 'Move Deck' }).click()
  await expect(page.locator('.changes-badge')).toHaveText('1')
}

test.describe('Move Cards page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  test('queues a move across lists and commits it', async ({ page }) => {
    let committed: CommitBody | null = null
    await mockMoveCardsApi(page, (body) => {
      committed = body as CommitBody
    })

    await page.locator('.admin-nav-item:has-text("Move Cards")').click()
    await expect(page.locator('.section-heading')).toContainText('Move Cards')

    // Browse the source collection and move its one card into the deck.
    await queueBinderCardIntoDeck(page)

    // The move is queued, so the card leaves the source view.
    await expect(page.locator('.edit-btn-move')).toHaveCount(0)

    // The pending dialog lists the queued move with its route.
    await page.locator('.btn-changes:has-text("Pending")').click()
    await expect(page.locator('.move-pending-row')).toContainText('Lightning Bolt')
    await expect(page.locator('.move-pending-row')).toContainText('Move Deck')
    await page.locator('.move-pending-dialog button:has-text("Done")').click()

    // The moved card shows up in the destination list (overlaid from the queued move).
    await page.locator('#move-list-select').selectOption('deck:move-deck')
    await expect(page.locator('.edit-btn-move')).toHaveCount(1)

    // Saving posts the queued move to the commit endpoint.
    await page.locator('.btn-save').click()
    await expect.poll(() => committed).not.toBeNull()
    expect(committed!.moves).toHaveLength(1)
    expect(committed!.moves[0]!.cardKey).toBe(BINDER_CARD_KEY)
    expect(committed!.moves[0]!.toType).toBe('deck')
    expect(committed!.moves[0]!.toSlug).toBe('move-deck')

    // After a successful commit the queue is cleared.
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('leaving with moves still queued prompts before dropping them', async ({ page }) => {
    await mockMoveCardsApi(page)

    await page.locator('.admin-nav-item:has-text("Move Cards")').click()
    await queueBinderCardIntoDeck(page)

    // The queue also blocks a reload or tab close.
    const unloadPrevented = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(unloadPrevented).toBe(true)

    // Refusing keeps the page and its queue.
    await page.locator('.admin-nav-item:has-text("Dashboard")').click()
    const dialog = page.locator('.modal-shell[open]')
    await expect(dialog).toContainText('1 queued move has not been saved')
    await dialog.locator('button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.section-heading')).toContainText('Move Cards')
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Confirming leaves, discarding the queue with the page.
    await page.locator('.admin-nav-item:has-text("Dashboard")').click()
    await page.locator('.modal-shell[open] .btn-danger').click()
    await expect(page.locator('.section-heading')).toContainText('Dashboard')
  })

  test('search finds a card across lists and opens its destination menu', async ({ page }) => {
    await mockMoveCardsApi(page)

    await page.locator('.admin-nav-item:has-text("Move Cards")').click()
    await expect(page.locator('.section-heading')).toContainText('Move Cards')

    // Each term is matched separately, so the terms need not be contiguous or
    // in order — "bol ligh" finds "Lightning Bolt" just as "Lightning" does.
    await page.locator('#move-search-input').fill('bol ligh')
    const row = page.locator('.move-search-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Lightning Bolt')
    await expect(row).toContainText('Move Binder')

    // The whole row is the move button.
    await row.click()
    await expect(page.locator('.move-destination-menu')).toBeVisible()
    // The card's own list is excluded; the other two are offered.
    await expect(page.locator('.move-destination-menu')).toContainText('Move Deck')
    await expect(page.locator('.move-destination-menu')).toContainText('Move Wishlist')
    await expect(page.locator('.move-destination-menu')).not.toContainText('Move Binder')
  })
})
