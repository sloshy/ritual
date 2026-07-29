import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import { mockMoveCardsApi } from '../helpers/mock-admin'

// 30 destination decks → a tall "Move To…" destination menu, so it exceeds the
// space below the anchor. Regression guard for the shared anchored-menu positioning
// (`useAnchoredMenu`): it previously used a fixed height estimate and ran off the
// bottom of the screen instead of clamping/scrolling so every option stays reachable.
// (The edit-mode card context menu no longer lists destinations inline — it opens a
// centered picker — so the batch Move Cards menu is now the tall anchored surface.)
const DEST_DECKS = Array.from({ length: 30 }, (_, i) => ({
  type: 'deck' as const,
  slug: `dest-${i + 1}`,
  name: `Destination ${i + 1}`,
}))

test('tall move-destination menu stays within the viewport', async ({ page }) => {
  await gotoAdminDashboard(page)
  await mockMoveCardsApi(page)

  // Override the move index with one card in a binder plus many destination decks.
  // Must be registered AFTER mockMoveCardsApi — Playwright stacks routes last-wins,
  // so this override has to come second to actually serve the 30-deck payload.
  await fulfillJson(page, '**/api/card-index', {
    success: true,
    lists: [{ type: 'collection', slug: 'move-binder', name: 'Move Binder' }, ...DEST_DECKS],
    cards: [
      {
        key: 'collection:move-binder:1:0',
        listType: 'collection',
        listSlug: 'move-binder',
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        condition: 'NM',
        cardId: 1,
        copyIndex: 0,
      },
    ],
  })

  await page.locator('.admin-nav-item:has-text("Move Cards")').click()
  await expect(page.locator('.section-heading')).toContainText('Move Cards')

  await page.locator('#move-list-select').selectOption('collection:move-binder')
  const moveButton = page.locator('.edit-btn-move')
  await expect(moveButton).toHaveCount(1)
  await moveButton.first().click()

  const menu = page.locator('.move-destination-menu')
  await expect(menu).toBeVisible()

  const box = await menu.boundingBox()
  const viewportH = await page.evaluate(() => window.innerHeight)
  const viewportW = await page.evaluate(() => window.innerWidth)
  expect(box).not.toBeNull()
  // The whole menu must be on-screen (a couple px tolerance for borders/rounding).
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportH + 1)
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportW + 1)
  // And it must be taller-than-fits → scrollable, so every option is reachable.
  const overflowY = await menu.evaluate((el) => getComputedStyle(el).overflowY)
  expect(overflowY).toBe('auto')
})
