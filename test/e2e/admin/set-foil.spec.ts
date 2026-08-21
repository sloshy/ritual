import { test, expect } from '@playwright/test'
import type { ScryfallCard } from '../../../src/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

/** A Lightning Bolt printing that supports both nonfoil and foil finishes. */
const BOLT: ScryfallCard = makeMockScryfallCard({
  id: 'bolt-lea',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  prices: { usd: '1.00', usd_foil: '3.00', eur: '0.80' },
  finishes: ['nonfoil', 'foil'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  color_identity: ['R'],
})

/** A Counterspell printing, used by the deck line that pins no printing. */
const COUNTERSPELL: ScryfallCard = makeMockScryfallCard({
  id: 'counterspell-lea',
  name: 'Counterspell',
  cmc: 2,
  type_line: 'Instant',
  oracle_text: 'Counter target spell.',
  prices: { usd: '2.00', usd_foil: '6.00', eur: '1.60' },
  finishes: ['nonfoil', 'foil'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '55',
  color_identity: ['U'],
})

/** A second Counterspell printing, so the picker has a real choice to make. */
const COUNTERSPELL_3ED: ScryfallCard = makeMockScryfallCard({
  id: 'counterspell-3ed',
  name: 'Counterspell',
  cmc: 2,
  type_line: 'Instant',
  oracle_text: 'Counter target spell.',
  prices: { usd: '0.50', usd_foil: '2.00', eur: '0.40' },
  finishes: ['nonfoil', 'foil'],
  set: '3ed',
  set_name: 'Revised Edition',
  collector_number: '61',
  color_identity: ['U'],
})

/** A printing for the name-only line that already carries a `[foil]` token. */
const SHOCK: ScryfallCard = makeMockScryfallCard({
  id: 'shock-m21',
  name: 'Shock',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Shock deals 2 damage to any target.',
  prices: { usd: '0.10', usd_foil: '0.30', eur: '0.08' },
  finishes: ['nonfoil', 'foil'],
  set: 'm21',
  set_name: 'Core Set 2021',
  collector_number: '159',
  color_identity: ['R'],
})

test.describe('Deck Editor — set as foil', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/decks',
      { decks: [{ slug: 'test-set-foil', name: 'Set Foil Deck' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/deck/test-set-foil', {
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
              // Name-only line: no set/collector number, so no printing to be foil of.
              { quantity: 1, name: 'Counterspell', cardId: 6 },
              // Name-only, but already carrying a `[foil]` token — clearing it
              // must stay reachable even though no printing is pinned.
              { quantity: 1, name: 'Shock', finish: 'foil', cardId: 7 },
            ],
          },
        ],
      },
      cards: { 'Lightning Bolt': BOLT, Counterspell: COUNTERSPELL, Shock: SHOCK },
      printings: {
        'Lightning Bolt': [BOLT],
        Counterspell: [COUNTERSPELL, COUNTERSPELL_3ED],
        Shock: [SHOCK],
      },
      lowestPriceCards: { 'Lightning Bolt': BOLT, Counterspell: COUNTERSPELL, Shock: SHOCK },
      lowestPriceCardsEur: { 'Lightning Bolt': BOLT, Counterspell: COUNTERSPELL, Shock: SHOCK },
      lowestPriceCardsTix: {},
      symbolMap: {},
      frontMatter: {},
    })

    await fulfillJson(page, '**/api/card-printings*', {
      success: true,
      printings: [COUNTERSPELL, COUNTERSPELL_3ED],
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

  test('a card with no printing cannot be set as foil until one is chosen', async ({ page }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Counterspell' }).first()

    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    const foil = menu.locator('button', { hasText: 'Set as Foil' })
    await expect(foil).toBeDisabled()

    // `aria-disabled` keeps the row focusable, so the onClick guard is the only
    // thing making it inert — a forced click must record nothing.
    await foil.click({ force: true })
    await expect(page.locator('.changes-badge')).toHaveCount(0)
    await expect(foil).toHaveAttribute('title', /Set a printing first/)

    // Pinning a printing through the same menu enables it.
    await menu.locator('button', { hasText: 'Set Printing' }).click()
    await page.locator('.printing-select-card', { hasText: '3ED' }).click()
    // 3ED offers both finishes, so the flow stops on the finish step; commit it
    // as nonfoil, leaving the menu row as the way to make the line foil.
    await page.locator('.add-card-actions button', { hasText: 'Update Card' }).click()

    // Pinned, and still nonfoil — so the sheen below is the menu row's doing.
    await expect(tile.locator('.foil-card')).toHaveCount(0)
    await tile.locator('.edit-btn-context').click()
    await expect(menu.locator('button', { hasText: 'Set as Foil' })).toBeEnabled()

    // And it applies, as it does for an already-pinned line.
    await menu.locator('button', { hasText: 'Set as Foil' }).click()
    await expect(tile.locator('.foil-card')).toHaveCount(1)
    // The printing change and the finish change are both recorded.
    await expect(page.locator('.changes-badge')).toHaveText('2')
  })

  test('a name-only card that is already foil can still be set back to nonfoil', async ({
    page,
  }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Shock' }).first()
    await expect(tile.locator('.foil-card')).toHaveCount(1)

    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await menu.locator('button', { hasText: 'Set as Nonfoil' }).click()

    await expect(tile.locator('.foil-card')).toHaveCount(0)
  })
})
