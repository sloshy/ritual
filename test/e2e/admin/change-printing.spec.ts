import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { disableSearchDebounce } from '../helpers/search-modal'

/** Build a synthetic Scryfall printing for Lightning Bolt with a given USD price. */
function boltPrinting(set: string, setName: string, collectorNumber: string, usd: string) {
  return {
    id: `bolt-${set}`,
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
    prices: {
      usd,
      usd_foil: null,
      usd_etched: null,
      eur: '0.80',
      eur_foil: null,
      tix: null,
    },
    finishes: ['nonfoil'],
    games: ['paper'],
    set,
    set_name: setName,
    collector_number: collectorNumber,
    rarity: 'common',
    color_identity: ['R'],
  }
}

// Distinct prices so we can assert the rendered card reflects the chosen printing.
const LEA_BOLT = boltPrinting('lea', 'Limited Edition Alpha', '161', '1.00')
const M10_BOLT = boltPrinting('m10', 'Magic 2010', '146', '2.50')

test.describe('Deck Editor — change printing', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await loginAsAdmin(page)

    await page.route('**/api/decks', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            decks: [{ slug: 'test-change-printing', name: 'Change Printing Deck' }],
          }),
        })
      } else {
        await route.continue()
      }
    })

    await page.route('**/api/deck/test-change-printing', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          slug: 'test-change-printing',
          contentHash: 'hash-1',
          deck: {
            name: 'Change Printing Deck',
            sections: [
              {
                name: 'Main',
                cards: [
                  {
                    quantity: 4,
                    name: 'Lightning Bolt',
                    set: 'lea',
                    collectorNumber: '161',
                    cardId: 5,
                  },
                ],
              },
            ],
          },
          cards: { 'Lightning Bolt': LEA_BOLT },
          printings: { 'Lightning Bolt': [LEA_BOLT, M10_BOLT] },
          lowestPriceCards: { 'Lightning Bolt': LEA_BOLT },
          lowestPriceCardsEur: { 'Lightning Bolt': LEA_BOLT },
          lowestPriceCardsTix: {},
          symbolMap: {},
          frontMatter: {},
        }),
      })
    })

    await page.route('**/api/card-printings*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, printings: [LEA_BOLT, M10_BOLT] }),
      })
    })

    await openListEditor(page, 'deck')

    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    await select.selectOption('test-change-printing')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  const openChangePrinting = async (page: import('@playwright/test').Page) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' }).first()
    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    await menu.locator('button', { hasText: 'Change Printing' }).click()
  }

  test('changing all copies records a single set-printing change and keeps one tile', async ({
    page,
  }) => {
    // The tile initially renders the LEA printing's price.
    const tile = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' }).first()
    await expect(tile).toContainText('1.00')

    await openChangePrinting(page)

    // Quantity prompt appears because the entry has 4 copies; keep the default (all 4).
    const qtyInput = page.locator('#change-printing-qty')
    await expect(qtyInput).toBeVisible()
    await expect(qtyInput).toHaveValue('4')
    await page.locator('.modal-panel button', { hasText: 'Continue' }).click()

    // The reused printing picker opens straight on the printing step.
    await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing')
    await page.locator('.printing-select-card', { hasText: 'M10' }).click()

    // One set-printing change; still a single Lightning Bolt tile.
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await expect(page.locator('.card-item').filter({ hasText: 'Lightning Bolt' })).toHaveCount(1)

    // The rendered card now reflects the M10 printing (its price), before saving.
    await expect(
      page.locator('.card-item').filter({ hasText: 'Lightning Bolt' }).first(),
    ).toContainText('2.50')

    // The change is logged unambiguously by ID and target printing.
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .changes-dialog')).toContainText(
      'Set Lightning Bolt printing to M10:146',
    )
  })

  test('changing some copies splits the entry into two printings', async ({ page }) => {
    await openChangePrinting(page)

    const qtyInput = page.locator('#change-printing-qty')
    await expect(qtyInput).toBeVisible()
    await qtyInput.fill('2')
    await page.locator('.modal-panel button', { hasText: 'Continue' }).click()

    await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing')
    await page.locator('.printing-select-card', { hasText: 'M10' }).click()

    // 2 copies removed from the original + 2 copies of the new printing added = 4 changes.
    await expect(page.locator('.changes-badge')).toHaveText('4')

    // The entry is now split into two Lightning Bolt tiles, each rendering its
    // own printing's price (LEA $1.00 stays; the new M10 copies show $2.50).
    const tiles = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' })
    await expect(tiles).toHaveCount(2)
    await expect(tiles.filter({ hasText: '1.00' })).toHaveCount(1)
    await expect(tiles.filter({ hasText: '2.50' })).toHaveCount(1)

    // The changelog shows the quantity decrease (removes) plus the new-printing adds.
    await page.locator('.btn-changes').click()
    const changes = page.locator('.changes-modal .changes-dialog')
    await expect(changes).toContainText('Remove Lightning Bolt')
    await expect(changes).toContainText('Add Lightning Bolt (M10:146)')
  })

  test('cancelling the quantity prompt aborts without opening the printing picker', async ({
    page,
  }) => {
    await openChangePrinting(page)

    const qtyInput = page.locator('#change-printing-qty')
    await expect(qtyInput).toBeVisible()

    // Scope to the quantity dialog — the discard dialog (always in the DOM) also
    // has a "Cancel" button under a `.modal-panel`.
    await page.locator('dialog:has(#change-printing-qty) button', { hasText: 'Cancel' }).click()

    // Dismissing the quantity prompt must end the flow: the printing picker never
    // opens and no change is recorded.
    await expect(qtyInput).toBeHidden()
    await expect(page.locator('.modal-heading-flex')).toHaveCount(0)
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })
})
