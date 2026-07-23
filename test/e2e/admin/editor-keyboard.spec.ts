import { test, expect, type Page } from '@playwright/test'
import type { ScryfallCard } from '../../../src/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

// The deck's single existing card. Its printings list is long enough to fill
// several grid rows so row-wise navigation has somewhere to go.
const BOLT = makeMockScryfallCard({
  id: 'bolt-lea-161',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  prices: { usd: '1.00' },
})

const BOLT_PRINTINGS: ScryfallCard[] = Array.from({ length: 8 }, (_, i) =>
  makeMockScryfallCard({
    id: `bolt-printing-${i}`,
    name: 'Lightning Bolt',
    type_line: 'Instant',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: String(161 + i),
    prices: { usd: '1.00' },
  }),
)

// A second card whose printing has both finishes, so adding it always stops on
// the finish/condition step instead of being auto-resolved.
const HELIX = makeMockScryfallCard({
  id: 'helix-rav-154',
  name: 'Lightning Helix',
  type_line: 'Instant',
  finishes: ['nonfoil', 'foil'],
  set: 'rav',
  set_name: 'Ravnica: City of Guilds',
  collector_number: '154',
  prices: { usd: '2.00', usd_foil: '8.00' },
})

async function openDeckEditor(page: Page): Promise<void> {
  await disableSearchDebounce(page)
  await gotoAdminDashboard(page)

  await fulfillJson(
    page,
    '**/api/decks',
    { decks: [{ slug: 'keyboard-deck', name: 'Keyboard Deck' }] },
    { method: 'GET' },
  )

  await fulfillJson(page, '**/api/deck/keyboard-deck', {
    success: true,
    slug: 'keyboard-deck',
    deck: {
      name: 'Keyboard Deck',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
        },
      ],
    },
    cards: { 'Lightning Bolt': BOLT },
    printings: { 'Lightning Bolt': BOLT_PRINTINGS },
    lowestPriceCards: { 'Lightning Bolt': BOLT },
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: {},
  })

  await fulfillJson(page, '**/api/autocomplete*', {
    success: true,
    names: ['Lightning Bolt', 'Lightning Helix'],
  })

  await fulfillJson(page, '**/api/card-printings*', (route) => ({
    success: true,
    printings:
      new URL(route.request().url()).searchParams.get('name') === 'Lightning Helix'
        ? [HELIX]
        : BOLT_PRINTINGS,
  }))

  await openListEditor(page, 'deck')
  const select = page.locator('#deck-select')
  await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
    timeout: 10_000,
  })
  await select.selectOption('keyboard-deck')
  await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
}

/** Advance the open search modal to the printing step for `cardName`. */
async function gotoPrintingStep(page: Page, cardName: string): Promise<void> {
  const searchInput = page.locator('.search-modal input[type="text"]')
  await expect(searchInput).toBeVisible({ timeout: 5_000 })
  await searchInput.fill(cardName)
  await page.locator('.search-result-item', { hasText: cardName }).click()
  await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
    timeout: 5_000,
  })
}

/** The printing grid's live column count, as row navigation computes it. */
async function gridColumns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const grid = document.querySelector('.printing-select-grid')
    if (!grid) return 1
    return getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter((t) => t !== '').length
  })
}

test.describe('Admin Editor — keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await openDeckEditor(page)
  })

  test('Ctrl+Enter opens the add card modal and Ctrl+B focuses the action bar', async ({
    page,
  }) => {
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.search-modal input[type="text"]')).toBeVisible({ timeout: 5_000 })

    // The Scryfall-backend note is public-site-only; the admin search runs on
    // the local cache and shows no attribution.
    await expect(page.locator('.search-source-note')).toHaveCount(0)

    // Page-level shortcuts are suppressed while a dialog is open: Ctrl+B must
    // not pull focus out of the modal and into the bar behind it.
    await page.keyboard.press('Control+b')
    await expect(page.locator('.editor-action-bar .btn-add')).not.toBeFocused()
    await expect(page.locator('.search-modal input[type="text"]')).toBeVisible()

    // So Escape is the only thing that closes it — then focus can move to the bar.
    await page.keyboard.press('Escape')
    await expect(page.locator('.search-modal input[type="text"]')).toHaveCount(0, {
      timeout: 3_000,
    })

    await page.keyboard.press('Control+b')
    await expect(page.locator('.editor-action-bar .btn-add')).toBeFocused()

    // Arrow keys rove between the bar's buttons; Escape releases focus.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.editor-action-bar .btn-defaults')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.editor-action-bar .btn-add')).toBeFocused()

    // Roving wraps at both ends rather than stopping; the help button is last.
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.editor-action-bar .btn-shortcuts')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.editor-action-bar .btn-add')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.locator('.editor-action-bar .btn-add')).not.toBeFocused()

    // Focused bar button still activates on Enter.
    await page.keyboard.press('Control+b')
    await page.keyboard.press('Enter')
    await expect(page.locator('.search-modal input[type="text"]')).toBeVisible({ timeout: 5_000 })
  })

  test('? opens the shortcuts reference, except while typing', async ({ page }) => {
    const dialog = page.locator('.shortcuts-dialog')

    await page.keyboard.press('?')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    // The reference documents the bindings the editor actually implements,
    // down to the keys each one is spelled with.
    await expect(dialog.locator('.shortcuts-row', { hasText: 'Add a card' })).toContainText('Ctrl')
    const rowKeys = dialog
      .locator('.shortcuts-row', { hasText: 'Previous / next row' })
      .locator('kbd')
    await expect(rowKeys).toHaveText(['↑', '↓'])

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible({ timeout: 3_000 })

    // Typing ? into a field must insert the character, not open the dialog.
    await page.locator('.btn-defaults').click()
    const setsInput = page.locator('#defaults-sets')
    await setsInput.click()
    await page.keyboard.press('?')
    await expect(setsInput).toHaveValue('?')
    await expect(dialog).not.toBeVisible()

    // The action bar's help button opens the same dialog.
    await setsInput.fill('')
    await page.locator('.btn-shortcuts').click()
    await expect(dialog).toBeVisible({ timeout: 5_000 })
  })

  test('printing grid moves by card with ←/→ and by row with ↑/↓', async ({ page }) => {
    await page.keyboard.press('Control+Enter')
    await gotoPrintingStep(page, 'Lightning Bolt')

    const tiles = page.locator('.printing-select-grid > *')
    const highlighted = page.locator(
      '.printing-select-card--highlighted, .printing-no-printing--highlighted',
    )
    const columns = await gridColumns(page)
    expect(columns).toBeGreaterThan(1)

    // Highlight starts on the first tile ("No specific printing" for decks).
    await expect(tiles.nth(0)).toHaveClass(/--highlighted/)

    await page.keyboard.press('ArrowRight')
    await expect(tiles.nth(1)).toHaveClass(/--highlighted/)

    // Down moves a whole row from the current position, not one card.
    await page.keyboard.press('ArrowDown')
    await expect(tiles.nth(1 + columns)).toHaveClass(/--highlighted/)
    await expect(highlighted).toHaveCount(1)

    await page.keyboard.press('ArrowUp')
    await expect(tiles.nth(1)).toHaveClass(/--highlighted/)

    // Up from the first row clamps to the first tile rather than wrapping.
    await page.keyboard.press('ArrowUp')
    await expect(tiles.nth(0)).toHaveClass(/--highlighted/)

    // ←/→ clamp at the ends of the list too, rather than wrapping around.
    await page.keyboard.press('ArrowLeft')
    await expect(tiles.nth(0)).toHaveClass(/--highlighted/)
    for (let i = 0; i < BOLT_PRINTINGS.length + 2; i++) {
      await page.keyboard.press('ArrowRight')
    }
    await expect(tiles.last()).toHaveClass(/--highlighted/)
    await expect(highlighted).toHaveCount(1)
  })

  test('Enter on the finish/condition step adds the card', async ({ page }) => {
    await page.keyboard.press('Control+Enter')
    await gotoPrintingStep(page, 'Lightning Helix')

    // Both finishes are available, so the flow stops for confirmation.
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.locator('.modal-heading-flex')).toContainText('Set finish & condition', {
      timeout: 5_000,
    })

    // Focus lands on the pre-selected finish, so arrows change the selection.
    const finishRadios = page.locator('.finish-condition-grid input[name="finish"]')
    await expect(finishRadios.first()).toBeFocused({ timeout: 5_000 })
    await page.keyboard.press('ArrowDown')
    await expect(finishRadios.nth(1)).toBeChecked()

    // Enter commits without reaching for the Add Card button.
    await page.keyboard.press('Enter')
    await expect(page.locator('.modal-heading-flex')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.locator('.card-item', { hasText: 'Lightning Helix' })).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.locator('.changes-badge')).toHaveText('1')
  })

  test('Add Another Card commits and restarts the search instead of closing', async ({ page }) => {
    const searchInput = page.locator('.search-modal input[type="text"]')

    /** From the search step, drive Lightning Helix to the finish/condition step. */
    const gotoFinishCondition = async () => {
      await gotoPrintingStep(page, 'Lightning Helix')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
      await expect(page.locator('.modal-heading-flex')).toContainText('Set finish & condition', {
        timeout: 5_000,
      })
    }

    await page.keyboard.press('Control+Enter')
    await gotoFinishCondition()

    // Both commit buttons advertise their shortcut in a corner chip.
    const addCard = page.locator('.add-card-actions button', { hasText: /^Add Card/ })
    const addAnother = page.locator('.add-card-actions button', { hasText: 'Add Another Card' })
    await expect(addCard.locator('kbd')).toHaveText(['Enter'])
    await expect(addAnother.locator('kbd')).toHaveText(['Ctrl', 'Enter'])

    // Clicking Add Another Card records the add but reopens a blank search step.
    await addAnother.click()
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await expect(searchInput).toHaveValue('')
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Ctrl+Enter does the same from the keyboard.
    await gotoFinishCondition()
    await page.keyboard.press('Control+Enter')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await expect(searchInput).toHaveValue('')

    // Both adds landed once the modal is dismissed: two change events, and the
    // card is on the list.
    await page.keyboard.press('Escape')
    await expect(searchInput).toHaveCount(0, { timeout: 3_000 })
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await expect(page.locator('.card-item', { hasText: 'Lightning Helix' })).toBeVisible({
      timeout: 5_000,
    })
  })
})
