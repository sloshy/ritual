import { test, expect } from '@playwright/test'
import type { ScryfallCard } from '../../../../src/types'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { disableSearchDebounce } from '../helpers/search-modal'

/** A Lightning Bolt printing that supports both nonfoil and foil finishes. */
const BOLT: ScryfallCard = {
  id: 'bolt-lea',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: {
    usd: '1.00',
    usd_foil: '3.00',
    usd_etched: null,
    eur: '0.80',
    eur_foil: null,
    tix: null,
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  color_identity: ['R'],
}

test.describe('Deck Editor — set as foil', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await loginAsAdmin(page)

    await page.route('**/api/decks', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ decks: [{ slug: 'test-set-foil', name: 'Set Foil Deck' }] }),
        })
      } else {
        await route.continue()
      }
    })

    await page.route('**/api/deck/test-set-foil', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          slug: 'test-set-foil',
          contentHash: 'hash-1',
          deck: {
            name: 'Set Foil Deck',
            sections: [
              {
                name: 'Main',
                cards: [
                  {
                    quantity: 1,
                    name: 'Lightning Bolt',
                    set: 'lea',
                    collectorNumber: '161',
                    cardId: 5,
                  },
                ],
              },
            ],
          },
          cards: { 'Lightning Bolt': BOLT },
          printings: { 'Lightning Bolt': [BOLT] },
          lowestPriceCards: { 'Lightning Bolt': BOLT },
          lowestPriceCardsEur: { 'Lightning Bolt': BOLT },
          lowestPriceCardsTix: {},
          symbolMap: {},
          frontMatter: {},
        }),
      })
    })

    await openListEditor(page, 'deck')

    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    await select.selectOption('test-set-foil')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  test('toggling foil applies the foil sheen to the deck card tile', async ({ page }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' }).first()

    // Initially nonfoil: no foil sheen on the rendered tile.
    await expect(tile.locator('.foil-card')).toHaveCount(0)

    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    await menu.locator('button', { hasText: 'Set as Foil' }).click()

    // The sheen now renders on the active view container, mirroring the collection
    // and wanted editors.
    await expect(tile.locator('.foil-card')).toHaveCount(1)

    // One set-finish change is recorded and logged.
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toContainText(
      'Set Lightning Bolt finish to foil',
    )
  })
})
