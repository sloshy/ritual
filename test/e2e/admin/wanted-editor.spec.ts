import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/** Two printings of one card at clearly different prices, so a tile names which it renders. */
const LEA_BOLT = makeMockScryfallCard({
  id: 'bolt-lea',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: '1.00' },
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
})
const M10_BOLT = makeMockScryfallCard({
  id: 'bolt-m10',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: '2.50' },
  set: 'm10',
  set_name: 'Magic 2010',
  collector_number: '146',
})

test.describe('Wanted List Editor — adding a pinned copy of a card already listed', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/wanted',
      { wantedLists: [{ slug: 'test-pinned-add', name: 'Pinned Add' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/wanted/test-pinned-add', {
      success: true,
      view: 'full',
      slug: 'test-pinned-add',
      contentHash: 'hash-1',
      // Pins no printing, so it renders the by-name representative (LEA).
      entries: [{ name: 'Lightning Bolt', fileOrder: 0, cardId: 1 }],
      sectionOrder: [],
      // Only the representative is keyed by name: M10 is not in the map yet, which
      // is exactly the state the added copy has to repair.
      cards: { 'Lightning Bolt': LEA_BOLT, 'lea:161': LEA_BOLT },
      printings: { 'Lightning Bolt': [LEA_BOLT, M10_BOLT] },
      symbolMap: {},
      warnings: [],
    })

    await fulfillJson(page, '**/api/autocomplete*', {
      success: true,
      names: ['Lightning Bolt'],
    })
    await fulfillJson(page, '**/api/card-printings*', {
      success: true,
      printings: [LEA_BOLT, M10_BOLT],
    })

    await openListEditor(page, 'wanted')
    await selectList(page, 'wanted', 'test-pinned-add')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  test('the new copy renders its own printing, not the representative', async ({ page }) => {
    const tiles = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' })
    await expect(tiles).toHaveCount(1)
    await expect(tiles.first()).toContainText('1.00')

    await page.keyboard.press('Control+Enter')
    const searchInput = page.locator('.search-modal input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Lightning Bolt')
    await page.locator('.search-result-item', { hasText: 'Lightning Bolt' }).first().click()
    // Nonfoil-only, so picking it auto-resolves the finish step and commits.
    await page.locator('.printing-select-card', { hasText: 'M10' }).click()

    // The added entry pins M10, so its tile prices off M10 — the entry that still
    // pins nothing keeps the representative. A tile whose lookup key just flipped
    // from the name to `m10:146` has to notice the key arriving.
    await expect(tiles).toHaveCount(2)
    await expect(tiles.filter({ hasText: '2.50' })).toHaveCount(1)
    await expect(tiles.filter({ hasText: '1.00' })).toHaveCount(1)
  })
})
