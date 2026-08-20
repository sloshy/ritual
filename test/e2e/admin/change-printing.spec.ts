import { test, expect } from '@playwright/test'
import type { Finish, ScryfallCard } from '../../../src/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openDeckWithCards } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { selectCard } from '../helpers/list-ui'
import { disableSearchDebounce } from '../helpers/search-modal'

type BoltPrintingSpec = {
  set: string
  setName: string
  collectorNumber: string
  usd: string
  /** Foil quote, for a printing offered in both finishes. */
  usdFoil?: string
  /** Defaults to nonfoil-only, which auto-resolves the finish step away. */
  finishes?: Finish[]
}

/** Build a synthetic Scryfall printing for Lightning Bolt with a given USD price. */
function boltPrinting(spec: BoltPrintingSpec): ScryfallCard {
  return makeMockScryfallCard({
    id: `bolt-${spec.set}`,
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    prices: { usd: spec.usd, usd_foil: spec.usdFoil ?? null, eur: '0.80' },
    set: spec.set,
    set_name: spec.setName,
    collector_number: spec.collectorNumber,
    color_identity: ['R'],
    finishes: spec.finishes ?? ['nonfoil'],
  })
}

// Distinct prices so we can assert the rendered card reflects the chosen printing.
const LEA_BOLT = boltPrinting({
  set: 'lea',
  setName: 'Limited Edition Alpha',
  collectorNumber: '161',
  usd: '1.00',
})
const M10_BOLT = boltPrinting({
  set: 'm10',
  setName: 'Magic 2010',
  collectorNumber: '146',
  usd: '2.50',
})
// Offers both finishes, so picking it cannot auto-resolve and the flow stops on
// the finish/condition step — the only step with a commit button to inspect.
// (The identifier leads with a letter; the set code itself is `2xm`.)
const XM2_BOLT = boltPrinting({
  set: '2xm',
  setName: 'Double Masters',
  collectorNumber: '129',
  usd: '3.75',
  usdFoil: '11.20',
  finishes: ['nonfoil', 'foil'],
})

test.describe('Deck Editor — change printing', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/decks',
      { decks: [{ slug: 'test-change-printing', name: 'Change Printing Deck' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/deck/test-change-printing', {
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
      printings: { 'Lightning Bolt': [LEA_BOLT, M10_BOLT, XM2_BOLT] },
      lowestPriceCards: { 'Lightning Bolt': LEA_BOLT },
      lowestPriceCardsEur: { 'Lightning Bolt': LEA_BOLT },
      lowestPriceCardsTix: {},
      symbolMap: {},
      frontMatter: {},
    })

    await fulfillJson(page, '**/api/card-printings*', {
      success: true,
      printings: [LEA_BOLT, M10_BOLT, XM2_BOLT],
    })

    await openDeckWithCards(page, 'test-change-printing')
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

    // The prompt opens with the input focused and its value selected, so typing
    // replaces the default and Enter advances to the printing picker.
    const qtyInput = page.locator('#change-printing-qty')
    await expect(qtyInput).toBeFocused()
    await page.keyboard.type('2')
    await expect(qtyInput).toHaveValue('2')
    await page.keyboard.press('Enter')

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

  test('the finish step commits with "Update Card", not the add-flow buttons', async ({ page }) => {
    await openChangePrinting(page)

    await page.locator('#change-printing-qty').waitFor({ state: 'visible' })
    await page.locator('.modal-panel button', { hasText: 'Continue' }).click()

    // The dialog names itself for the flow it is actually running.
    await expect(page.getByRole('dialog', { name: 'Change printing' })).toBeVisible()
    // 2XM offers both finishes, so the flow stops on the finish/condition step.
    await page.locator('.printing-select-card', { hasText: '2XM' }).click()
    const actions = page.locator('.add-card-actions')
    await expect(actions).toBeVisible()

    // Each finish is priced in place, so the cost of foil vs nonfoil is visible
    // at the moment of choosing rather than after committing.
    // Scoped by the radio's value, not its text — "nonfoil" contains "foil".
    const finishOption = (finish: Finish) =>
      page.locator(`.radio-option:has(input[value="${finish}"]) .radio-option-price`)
    await expect(finishOption('nonfoil')).toHaveText('$3.75')
    await expect(finishOption('foil')).toHaveText('$11.20')

    // The card already exists — this re-targets its printing rather than adding,
    // so there is no "Add Another Card" and no copy count to answer (the quantity
    // prompt that opened the flow already did that).
    await expect(actions.locator('button')).toHaveCount(1)
    await expect(actions.locator('button')).toHaveText(/Update Card/)
    await expect(page.locator('#add-card-qty')).toHaveCount(0)
    // The footer key hint names the same verb as the button it describes.
    await expect(page.locator('.search-modal-footer')).toContainText('update card')

    await actions.locator('button').click()
    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .changes-dialog')).toContainText(
      'Set Lightning Bolt printing to 2XM:129',
    )
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

/** One card of the bulk deck: a pinned TST printing and a PLN one to switch to. */
function bulkPrintings(name: string, collectorNumber: string): ScryfallCard[] {
  const base = { name, cmc: 1, type_line: 'Instant', color_identity: ['R'] }
  return [
    makeMockScryfallCard({
      ...base,
      id: `${collectorNumber}-tst`,
      prices: { usd: '1.00' },
      set: 'tst',
      set_name: 'Test Set',
      collector_number: collectorNumber,
    }),
    makeMockScryfallCard({
      ...base,
      id: `${collectorNumber}-pln`,
      prices: { usd: '9.00' },
      set: 'pln',
      set_name: 'Plane Set',
      collector_number: collectorNumber,
    }),
  ]
}

const BULK_CARDS = ['Bulk Bolt', 'Bulk Shock', 'Bulk Growth']
const BULK_PRINTINGS: Record<string, ScryfallCard[]> = Object.fromEntries(
  BULK_CARDS.map((name, i) => [name, bulkPrintings(name, String(i + 1))]),
)

test.describe('Deck Editor — bulk change printing', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/decks',
      { decks: [{ slug: 'test-bulk-printing', name: 'Bulk Printing Deck' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/deck/test-bulk-printing', {
      success: true,
      slug: 'test-bulk-printing',
      contentHash: 'hash-1',
      deck: {
        name: 'Bulk Printing Deck',
        sections: [
          {
            name: 'Main',
            // One copy each, so no card stops the run on the quantity prompt.
            cards: BULK_CARDS.map((name, i) => ({
              quantity: 1,
              name,
              set: 'tst',
              collectorNumber: String(i + 1),
              cardId: i + 1,
            })),
          },
        ],
      },
      cards: Object.fromEntries(BULK_CARDS.map((name) => [name, BULK_PRINTINGS[name]![0]])),
      printings: BULK_PRINTINGS,
      lowestPriceCards: {},
      lowestPriceCardsEur: {},
      lowestPriceCardsTix: {},
      symbolMap: {},
      frontMatter: {},
    })

    await fulfillJson(page, '**/api/card-printings*', (route) => ({
      success: true,
      printings:
        BULK_PRINTINGS[new URL(route.request().url()).searchParams.get('name') ?? ''] ?? [],
    }))

    await openDeckWithCards(page, 'test-bulk-printing')
  })

  test('a bulk run prompts for every selected card, skipping none', async ({ page }) => {
    for (let i = 0; i < BULK_CARDS.length; i++) await selectCard(page, i)
    await expect(page.locator('.selection-menu-btn')).toHaveText(/Selected \(3\)/)

    await page.locator('.selection-menu-btn').click()
    await page
      .locator('.selection-menu-panel .selection-menu-item', { hasText: 'Change Printing' })
      .click()

    // Each committed card must hand the run to the *next* one — a queue that
    // advances twice per commit would silently drop every other card. One click
    // per card, in whatever order the deck displays them.
    const heading = page.locator('.modal-heading-flex')
    for (let i = 0; i < BULK_CARDS.length; i++) {
      await expect(heading).toContainText('Select a printing for')
      await page.locator('.printing-select-card', { hasText: 'PLN' }).click()
    }

    // The picker closes on its own after the last card, and all three landed.
    await expect(heading).toHaveCount(0)
    await expect(page.locator('.changes-badge')).toHaveText('3')

    // Every tile re-renders against its new printing (PLN is the $9.00 one), so
    // the run reached the view and not just the changelog.
    await expect(page.locator('.card-item', { hasText: '9.00' })).toHaveCount(BULK_CARDS.length)

    // Each card's printings carry only its own collector number, so the target
    // in each entry is what pins that this card — not a repeat of another — was
    // the one prompted for. A skipped card is missing from this list entirely.
    await page.locator('.btn-changes').click()
    const changes = page.locator('.changes-modal .changes-dialog')
    for (const [i, name] of BULK_CARDS.entries()) {
      await expect(changes).toContainText(`Set ${name} printing to PLN:${i + 1}`)
    }
  })
})

test.describe('Deck Editor — a line with no printing pinned', () => {
  test.beforeEach(async ({ page }) => {
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/decks',
      { decks: [{ slug: 'test-unpinned-printing', name: 'Unpinned Deck' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/deck/test-unpinned-printing', {
      success: true,
      slug: 'test-unpinned-printing',
      contentHash: 'hash-1',
      deck: {
        name: 'Unpinned Deck',
        // Name only — no set/collectorNumber, and one copy so no quantity prompt.
        // The `cards` map still resolves the name to a printing (that is what the
        // tile renders); "pins none" is a property of the *entry*, which is what
        // the menu label reads. Pinning this entry would defeat the test.
        sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 5 }] }],
      },
      cards: { 'Lightning Bolt': LEA_BOLT },
      printings: { 'Lightning Bolt': [LEA_BOLT, M10_BOLT, XM2_BOLT] },
      lowestPriceCards: { 'Lightning Bolt': LEA_BOLT },
      lowestPriceCardsEur: {},
      lowestPriceCardsTix: {},
      symbolMap: {},
      frontMatter: {},
    })

    await fulfillJson(page, '**/api/card-printings*', {
      success: true,
      printings: [LEA_BOLT, M10_BOLT, XM2_BOLT],
    })

    await openDeckWithCards(page, 'test-unpinned-printing')
  })

  test('the context menu offers "Set Printing", then reads "Change Printing" once pinned', async ({
    page,
  }) => {
    const tile = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' }).first()
    // The by-name representative (LEA) is what an unpinned line renders.
    await expect(tile).toContainText('1.00')

    await tile.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await expect(menu.locator('button', { hasText: 'Set Printing' })).toBeVisible()
    await expect(menu.locator('button', { hasText: 'Change Printing' })).toHaveCount(0)

    await menu.locator('button', { hasText: 'Set Printing' }).click()
    // The picker names itself for the flow it is running, too.
    await expect(page.getByRole('dialog', { name: 'Set printing' })).toBeVisible()
    await page.locator('.printing-select-card', { hasText: 'M10' }).click()

    // The pending change pins the line, so the tile re-renders against M10 and
    // the row now reads "Change Printing" — the label follows live editor state.
    await expect(tile).toContainText('2.50')
    await tile.locator('.edit-btn-context').click()
    await expect(menu.locator('button', { hasText: 'Change Printing' })).toBeVisible()
    await expect(menu.locator('button', { hasText: 'Set Printing' })).toHaveCount(0)
  })
})
