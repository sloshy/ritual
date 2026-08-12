import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { mockMoveCardsApi } from '../helpers/mock-admin'
import type { MoveCommitRequest } from '../../../src/admin/api/move'

// The handler's own request type, so a mock can't drift from what it accepts.
type CommitBody = MoveCommitRequest

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

    // The moved card shows up in the destination list (overlaid from the queued
    // move), alongside the deck's own card.
    await page.locator('#move-list-select').selectOption('deck:move-deck')
    await expect(
      page.locator('.card-item', { hasText: 'Lightning Bolt' }).locator('.edit-btn-move'),
    ).toHaveCount(1)

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

  test('a printing-less card moving into a collection asks for a printing, then a count', async ({
    page,
  }) => {
    let committed: CommitBody | null = null
    await mockMoveCardsApi(page, (body) => {
      committed = body as CommitBody
    })

    await page.locator('.admin-nav-item:has-text("Move Cards")').click()
    await page.locator('#move-list-select').selectOption('deck:move-deck')

    // A two-copy entry with no printing; a collection destination needs one.
    await page.locator('.card-item', { hasText: 'Giant Growth' }).locator('.edit-btn-move').click()
    await page
      .locator('.move-destination-menu .card-context-menu-item', { hasText: 'Move Binder' })
      .click()

    await expect(page.locator('.modal-heading-flex')).toContainText(
      'Select a printing for Giant Growth',
    )
    await page.locator('.printing-select-card', { hasText: 'PLN' }).click()
    // Collections track condition and none is defaulted, so the flow stops here.
    await page.locator('.add-card-actions button').first().click()

    // Committing the printing must hand off to the copy-count prompt, not
    // dismiss the flow — the move used to be dropped silently right here.
    const qty = page.locator('#move-qty')
    await expect(qty).toBeVisible()
    await expect(qty).toHaveValue('2')
    await page.locator('dialog:has(#move-qty) button', { hasText: 'Move' }).click()

    await expect(page.locator('.changes-badge')).toHaveText('2')
    await page.locator('.btn-save').click()
    await expect.poll(() => committed).not.toBeNull()
    // Both copies route to the binder, each carrying the printing that was
    // picked — resolving it is the entire reason the prompt exists, so a move
    // that arrived without the override would defeat the flow just as silently.
    expect(committed!.moves).toHaveLength(2)
    expect(committed!.moves.map((m) => m.cardKey)).toEqual([
      'deck:move-deck:5:0',
      'deck:move-deck:5:1',
    ])
    for (const move of committed!.moves) {
      expect(move).toMatchObject({
        toType: 'collection',
        toSlug: 'move-binder',
        set: 'pln',
        collectorNumber: '7',
      })
    }
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
