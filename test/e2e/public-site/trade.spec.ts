import { test, expect, type Page, type Route } from '@playwright/test'
import { fulfillJson } from '../helpers/fulfill'
import {
  MOCK_TRADE_COLLECTION_CARD_BOLT,
  PICKER_BASE_PRINTING,
  mockPickerPrintings,
  mockPublicSiteForTrade,
} from '../helpers/mock-public-site'
import { addToLeft } from '../helpers/trade-page'

/**
 * Right-column (wanted-list mode) equivalent of {@link addToLeft}. A wanted card
 * never implies a printing, so this also completes the picker that opens. When
 * `expectSuggestion` is given, asserts the first suggestion's text before
 * clicking it.
 */
async function addToRight(page: Page, query: string, expectSuggestion?: string): Promise<void> {
  const rightSearch = page.locator('.trade-col[data-side="right"] .search-input')
  await rightSearch.fill(query)
  const suggest = page.locator('.trade-col[data-side="right"] .search-suggest')
  await expect(suggest).toBeVisible()
  const firstRow = suggest.locator('.search-suggest-row').first()
  if (expectSuggestion) await expect(firstRow).toContainText(expectSuggestion)
  await firstRow.click({ force: true })
  await confirmPrinting(page)
}

/** Choose a printing in the open picker and add it to the trade. */
async function confirmPrinting(page: Page, index = 0): Promise<void> {
  const modal = page.locator('.trade-picker-modal')
  await expect(modal).toBeVisible()
  await modal.locator('.trade-picker-item').nth(index).click()
  await modal.locator('button', { hasText: 'Add to Trade' }).click()
  await expect(modal).not.toBeVisible()
}

/**
 * Right-column equivalent of {@link addToLeft} for Scryfall mode: toggles the
 * search-mode switch, types the query, and clicks the first suggestion. When
 * `expectSuggestion` is given, asserts the first suggestion's text before
 * clicking it. Caller is responsible for handling the printing-picker modal
 * that opens afterward.
 */
async function scryfallAddToRight(
  page: Page,
  query: string,
  expectSuggestion?: string,
): Promise<void> {
  const rightColumn = page.locator('.trade-col[data-side="right"]')
  await rightColumn.locator('.search-mode-toggle').click()
  await rightColumn.locator('.search-input').fill(query)
  const suggest = rightColumn.locator('.search-suggest')
  await expect(suggest).toBeVisible({ timeout: 2000 })
  const firstRow = suggest.locator('.search-suggest-row').first()
  if (expectSuggestion) await expect(firstRow).toContainText(expectSuggestion)
  await firstRow.click({ force: true })
}

test.describe('Trade Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForTrade(page)
    await page.goto('/')
  })

  test('Trade nav link is visible and navigates to the trade page', async ({ page }) => {
    const tradeLink = page.locator('a[href="#/trade"]')
    await expect(tradeLink).toBeVisible()
    await tradeLink.click()
    await expect(page.locator('h1')).toContainText('Trade Editor')
  })

  test('left column: searching and adding a card from the collection', async ({ page }) => {
    await page.goto('#/trade')

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')

    const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest).toBeVisible()
    const firstRow = suggest.locator('.search-suggest-row').first()
    await expect(firstRow).toContainText('Lightning Bolt')

    await firstRow.click({ force: true })

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Lightning Bolt',
    )
  })

  test('left column: an accent-free query finds and adds the accented card', async ({ page }) => {
    await page.goto('#/trade')

    await addToLeft(page, 'jotun grunt')

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Jötun Grunt',
    )
  })

  test('left column: removing a card removes it from the list', async ({ page }) => {
    await page.goto('#/trade')

    await addToLeft(page, 'Lightning')

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Lightning Bolt',
    )

    await page.locator('.trade-col[data-side="left"] .trade-row-remove').first().click()

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toHaveCount(0)
  })

  test('left column: price total updates after adding a card', async ({ page }) => {
    await page.goto('#/trade')

    const leftTotal = page.locator('.trade-col[data-side="left"] .trade-col-foot-total')
    await expect(leftTotal).toContainText('—')

    await addToLeft(page, 'Lightning')

    // Mocked Lightning Bolt price is $2.50 (see MOCK_TRADE_COLLECTION_CARD_BOLT).
    await expect(leftTotal).toContainText('$2.50')
  })

  test('left column: priceless copies read as their marker and count as nothing', async ({
    page,
  }) => {
    await page.goto('#/trade')

    const left = page.locator('.trade-col[data-side="left"]')
    const leftTotal = left.locator('.trade-col-foot-total')

    // Custom art wins over the proxy label when a copy carries both, so this
    // $12 printing reads CUSTOM — in the suggestion and in the row it becomes.
    await left.locator('.search-input').fill('Altered')
    await expect(left.locator('.search-suggest .search-suggest-price')).toHaveText('CUSTOM')
    await addToLeft(page, 'Altered')

    const alteredRow = left.locator('.trade-row', { hasText: 'Altered Bauble' })
    await expect(alteredRow.locator('.trade-row-price')).toHaveText('CUSTOM')

    // The label alone reads PROXY.
    await addToLeft(page, 'Fake Relic')
    const fakeRow = left.locator('.trade-row', { hasText: 'Fake Relic' })
    await expect(fakeRow.locator('.trade-row-price')).toHaveText('PROXY')

    // Both printings are worth real money; neither may reach the column total.
    await expect(leftTotal).toHaveText('—')

    // A priced card still totals normally alongside them.
    await addToLeft(page, 'Lightning')
    await expect(leftTotal).toContainText('$2.50')
  })

  test('right column: price total updates after adding a wanted card', async ({ page }) => {
    await page.goto('#/trade')

    const rightTotal = page.locator('.trade-col[data-side="right"] .trade-col-foot-total')
    await expect(rightTotal).toContainText('—')

    await addToRight(page, 'Mana', 'Mana Crypt')

    await expect(page.locator('.trade-col[data-side="right"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
    // Mocked Mana Crypt price is $175.00 (see MOCK_TRADE_WANTED_CARD_CRYPT).
    await expect(rightTotal).toContainText('$175.00')
  })

  test('right column: a wanted card opens the picker with the wanted printing marked first', async ({
    page,
  }) => {
    // The wanted list asks for 2XM:270; the picker also offers an older printing.
    await mockPickerPrintings(page, [
      { ...PICKER_BASE_PRINTING, id: 'crypt-vma', set: 'vma', collector_number: '225' },
      { ...PICKER_BASE_PRINTING, id: 'crypt-2xm', set: '2xm', collector_number: '270' },
    ])

    await page.goto('#/trade')
    const right = page.locator('.trade-col[data-side="right"]')
    await right.locator('.search-input').fill('Mana')
    await right.locator('.search-suggest-row').first().click({ force: true })

    // Wanting a printing doesn't pick it: the picker opens, with the wanted one
    // floated to the top and badged.
    const items = page.locator('.trade-picker-modal .trade-picker-item')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('2XM:270')
    await expect(items.first().locator('.trade-picker-wanted-tag')).toBeVisible()
    await expect(items.nth(1).locator('.trade-picker-wanted-tag')).toHaveCount(0)

    // Taking the printing actually on offer keeps the row wanted-sourced.
    await confirmPrinting(page, 1)
    const row = right.locator('.trade-row').first()
    await expect(row.locator('.trade-row-name-text')).toContainText('Mana Crypt')
    await expect(row.locator('.trade-row-name-meta')).toContainText('VMA:225')
    await expect(row.locator('.src-tag')).toHaveText('Wanted')
  })

  test('left column: sort controls toggle and reverse the list order', async ({ page }) => {
    await page.goto('#/trade')

    // Add Lightning Bolt ($2.50) and Sol Ring ($3.00). Both name-ascending and
    // price-ascending order produce [Lightning Bolt, Sol Ring], so verifying
    // that Price activates *and* that the reverse toggle flips the order
    // exercises actual list reordering — not just the active-class swap.
    await addToLeft(page, 'Lightning')
    await addToLeft(page, 'Sol')

    const leftCol = page.locator('.trade-col[data-side="left"]')
    const rows = leftCol.locator('.trade-row-name-text')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Lightning Bolt')
    await expect(rows.nth(1)).toContainText('Sol Ring')

    await leftCol.locator('.view-toggle button', { hasText: 'Price' }).click()
    await expect(leftCol.locator('.view-toggle button.active')).toContainText('Price')

    // Reverse flips the price-ascending order. $3.00 Sol Ring should now lead.
    await leftCol.locator('.toolbar-toggle', { hasText: 'Reverse' }).click()
    await expect(rows.nth(0)).toContainText('Sol Ring')
    await expect(rows.nth(1)).toContainText('Lightning Bolt')

    await leftCol.locator('.view-toggle button', { hasText: 'Name' }).click()
    await expect(leftCol.locator('.view-toggle button.active')).toContainText('Name')
    // Switching sort axis resets `reverse` to false (see handleSort in
    // TradePage.tsx) — the list returns to alphabetical order.
    await expect(rows.nth(0)).toContainText('Lightning Bolt')
    await expect(rows.nth(1)).toContainText('Sol Ring')
  })

  test('printing picker: selecting a printing and clicking Add adds to right column', async ({
    page,
  }) => {
    await page.goto('#/trade')

    await scryfallAddToRight(page, 'Mana', 'Mana Crypt')

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-title')).toContainText('Mana Crypt')
    await modal.locator('.trade-picker-item').first().click()

    await modal.locator('button', { hasText: 'Add to Trade' }).click()

    await expect(page.locator('.trade-picker-modal')).not.toBeVisible()
    await expect(page.locator('.trade-col[data-side="right"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
  })

  test('printing picker: pressing Escape closes the picker', async ({ page }) => {
    await page.goto('#/trade')

    await scryfallAddToRight(page, 'Mana')

    await expect(page.locator('.trade-picker-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.trade-picker-modal')).not.toBeVisible()
  })

  test('left column: stepper hidden for single-copy cards', async ({ page }) => {
    await page.goto('#/trade')

    await addToLeft(page, 'Sol')

    const row = page.locator('.trade-col[data-side="left"] .trade-row').first()
    await expect(row.locator('.qty-stepper')).toHaveCount(0)
    await expect(row.locator('.qty-val-fixed')).toContainText('1')
  })

  test('left column: stepper caps at maxQty and decrements back down', async ({ page }) => {
    await page.goto('#/trade')

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')
    const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest).toBeVisible()
    // Three identical Lightning Bolts in the collection — single suggestion, maxQty=3
    await expect(suggest.locator('.search-suggest-row')).toHaveCount(1)
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    const row = page.locator('.trade-col[data-side="left"] .trade-row').first()
    const inc = row.locator('.qty-stepper button', { hasText: '+' })
    const dec = row.locator('.qty-stepper button', { hasText: '-' })
    const qty = row.locator('.qty-val')

    await expect(qty).toContainText('1')
    await inc.click()
    await expect(qty).toContainText('2')
    await inc.click()
    await expect(qty).toContainText('3')
    // Capped at 3
    await expect(inc).toBeDisabled()
    await inc.click({ force: true }).catch(() => {})
    await expect(qty).toContainText('3')

    await dec.click()
    await expect(qty).toContainText('2')
    await dec.click()
    await expect(qty).toContainText('1')
    // At qty 1 the decrement button is disabled — further decrease must use
    // the explicit remove control.
    await expect(dec).toBeDisabled()
  })

  test('left column: deck quantity sums across mainboard and sideboard', async ({ page }) => {
    await page.goto('#/trade')

    const leftColumn = page.locator('.trade-col[data-side="left"]')
    await leftColumn.locator('.search-mode-toggle').click()
    await leftColumn.locator('.search-input').fill('Sol')
    const suggest = leftColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    // Two suggestions: one from collection (maxQty 1) and one from deck (maxQty 3 = 2 main + 1 side)
    const deckRow = suggest.locator('.search-suggest-row', { hasText: 'In Trade Deck' })
    await deckRow.click({ force: true })

    const row = leftColumn.locator('.trade-row').first()
    const inc = row.locator('.qty-stepper button', { hasText: '+' })
    const qty = row.locator('.qty-val')

    await expect(qty).toContainText('1')
    await inc.click()
    await inc.click()
    await expect(qty).toContainText('3')
    await expect(inc).toBeDisabled()
  })

  test('left column: deck card without printing opens picker', async ({ page }) => {
    await page.goto('#/trade')

    const leftColumn = page.locator('.trade-col[data-side="left"]')
    // Toggle "Include cards in decks"
    await leftColumn.locator('.search-mode-toggle').click()

    await leftColumn.locator('.search-input').fill('Counter')
    const suggest = leftColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-title')).toContainText('Counterspell')

    await modal.locator('.trade-picker-item').first().click()
    await modal.locator('button', { hasText: 'Add to Trade' }).click()

    await expect(modal).not.toBeVisible()
    await expect(leftColumn.locator('.trade-row-name-text')).toContainText('Counterspell')
  })

  test('right column: scryfall-added card has edit button that re-opens picker and replaces in place', async ({
    page,
  }) => {
    await page.goto('#/trade')

    await scryfallAddToRight(page, 'Mana')
    const rightColumn = page.locator('.trade-col[data-side="right"]')

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.trade-picker-item').first().click()
    await modal.locator('button', { hasText: 'Add to Trade' }).click()
    await expect(modal).not.toBeVisible()

    // Row should now have an edit button
    const row = rightColumn.locator('.trade-row').first()
    const editBtn = row.locator('.trade-row-edit')
    await expect(editBtn).toBeVisible()

    // Bump qty so we can verify it's preserved across an edit
    await row.locator('.qty-stepper button', { hasText: '+' }).click()
    await expect(row.locator('.qty-val')).toContainText('2')

    // Click edit, picker re-opens with same card name
    await editBtn.click()
    await expect(modal).toBeVisible()
    await expect(page.locator('.trade-picker-title')).toContainText('Mana Crypt')

    await modal.locator('.trade-picker-item').first().click()
    await modal.locator('button', { hasText: 'Add to Trade' }).click()
    await expect(modal).not.toBeVisible()

    // Still exactly one row, qty preserved
    await expect(rightColumn.locator('.trade-row')).toHaveCount(1)
    await expect(rightColumn.locator('.trade-row .qty-val')).toContainText('2')
  })

  test('printing picker: filter box narrows by the collector query grammar', async ({ page }) => {
    // The grammar itself is pinned in test/unit/collector-query.test.ts; this
    // asserts the wiring only — the box narrows the list, renders the match
    // uppercase, and an unmatched query shows the empty state.
    await mockPickerPrintings(page, [
      { ...PICKER_BASE_PRINTING, id: 'a', set: '2xm', collector_number: '270' },
      { ...PICKER_BASE_PRINTING, id: 'b', set: 'mkm', collector_number: '12' },
      { ...PICKER_BASE_PRINTING, id: 'c', set: 'mkm', collector_number: '123' },
      { ...PICKER_BASE_PRINTING, id: 'd', set: 'lea', collector_number: '161' },
    ])

    await page.goto('#/trade')
    await scryfallAddToRight(page, 'Mana')

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(4)

    await modal.locator('.printing-filter').fill('mkm:123')
    await expect(modal.locator('.trade-picker-item')).toHaveCount(1)
    await expect(modal.locator('.trade-picker-set').first()).toContainText('MKM:123')

    await modal.locator('.printing-filter').fill('xx')
    await expect(modal.locator('.trade-picker-item')).toHaveCount(0)
    await expect(modal).toContainText('No printings match')
  })

  test('printing picker: typing anywhere feeds the filter without focusing it', async ({
    page,
  }) => {
    await mockPickerPrintings(page, [
      { ...PICKER_BASE_PRINTING, id: 'a', set: '2xm', collector_number: '270' },
      { ...PICKER_BASE_PRINTING, id: 'b', set: 'mkm', collector_number: '123' },
      { ...PICKER_BASE_PRINTING, id: 'c', set: 'lea', collector_number: '161' },
    ])

    await page.goto('#/trade')
    await scryfallAddToRight(page, 'Mana')

    const modal = page.locator('.trade-picker-modal')
    const filter = modal.locator('.printing-filter')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(3)

    // No click on the box: keys pressed anywhere in the dialog land in it.
    await page.keyboard.type('lea')
    await expect(filter).toHaveValue('lea')
    await expect(filter).not.toBeFocused()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(1)

    // Backspace erases the query from anywhere too, and mid-query Space is the
    // grammar's separator — not an activation of whatever button holds focus
    // (at open that is the picker's close button).
    await page.keyboard.press('Backspace')
    await expect(filter).toHaveValue('le')
    await page.keyboard.type('a 161')
    await expect(filter).toHaveValue('lea 161')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(1)

    // Escape clears the query but keeps the picker open…
    await page.keyboard.press('Escape')
    await expect(filter).toHaveValue('')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(3)

    // …and with nothing to clear, Escape dismisses the picker as before.
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
  })

  test('navigating to a trade URL restores left and right cards', async ({ page }) => {
    // Params live in the hash fragment so they are never sent to the server
    const params = new URLSearchParams()
    params.set('leftSideColIds', 'Trade Collection:1')
    params.set('rightSideWantedIds', 'Trade Wanted List:1@trade-crypt-id')
    await page.goto(`/#/trade?${params.toString()}`)

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Lightning Bolt',
    )
    await expect(page.locator('.trade-col[data-side="right"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
  })

  test('a static site restores a list-less trade row from Scryfall', async ({ page }) => {
    // No list holds this card, so its ID can only be resolved by asking
    // Scryfall — the hosted site asks its own cache instead (hosted-mode.spec).
    await page.goto('/#/trade?rightSideScryfall=x1@trade-crypt-id')

    const row = page.locator('.trade-col[data-side="right"] .trade-row').first()
    await expect(row.locator('.trade-row-name-text')).toContainText('Mana Crypt')
    await expect(row.locator('.src-tag')).toHaveText('Scryfall')
  })

  test('cold-load: trade URL fetches collections before decoding (regression)', async ({
    browser,
  }) => {
    // Regression: useSiteData populates `decks`/`collections`/`wantedLists` via three
    // sequential setSignal calls. If the gating effect in useTradeData triggers off the
    // first one, it reads the others while still null and silently skips the detail
    // fetches — the URL decode then sees zero entries and surfaces an "unknown-source"
    // warning even though the collection exists. The `beforeEach` in the rest of this
    // suite hides the bug by warming up via `page.goto('/')` first; this test uses a
    // fresh page that goes *directly* to the trade URL, matching the production scenario
    // where a user opens a saved trade link in a new tab.
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await mockPublicSiteForTrade(page)

      const collectionFetched = page.waitForRequest(
        (req) => req.url().includes('/collections/trade-collection.json'),
        { timeout: 5_000 },
      )

      await page.goto('/#/trade?leftSideColIds=Trade%20Collection%3A1')

      await collectionFetched
      await expect(page.locator('.trade-decode-warnings')).not.toBeVisible()
      await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
        'Lightning Bolt',
      )
    } finally {
      await ctx.close()
    }
  })

  test('a trade URL referencing missing IDs surfaces a dismissable warning banner', async ({
    page,
  }) => {
    const params = new URLSearchParams()
    // ID 999 doesn't exist in the mocked Trade Collection. The "Old Binder" source name
    // doesn't exist either, exercising both unknown-card-ids and unknown-source warnings.
    params.set('leftSideColIds', 'Trade Collection:999|Old%20Binder:1')
    await page.goto(`/#/trade?${params.toString()}`)

    const banner = page.locator('.trade-decode-warnings')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('999')
    await expect(banner).toContainText('Old Binder')

    await banner.locator('.trade-decode-warnings-dismiss').click()
    await expect(banner).not.toBeVisible()
    // Note: dismissal only clears `decodeWarnings` state — see the onClick
    // handler in TradePage.tsx. The invalid params remain in the URL hash, so
    // a refresh would re-surface the banner. If we ever change that, add a
    // follow-up assertion here that the URL is cleaned.
  })

  test('navigating to a deck URL restores plain and picker-selected cards', async ({ page }) => {
    // Sol Ring in the deck has cardId 2 (mainboard) and 3 (sideboard), aggregated as one
    // entry — restored by plain numeric ID. Counterspell has cardId 1 with no
    // set/collectorNumber in the deck data — the @sfId override selects its printing.
    // Both tokens share one comma-separated leftSideDeckIds group.
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Trade Deck:2x1,1x1@trade-counterspell-id')
    await page.goto(`/#/trade?${params.toString()}`)

    const rows = page.locator('.trade-col[data-side="left"] .trade-row-name-text')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'Sol Ring' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Counterspell' })).toHaveCount(1)
  })

  test('Copy Link then reload preserves the full trade state', async ({ page }) => {
    await page.goto('#/trade')

    await addToLeft(page, 'Sol')
    await addToRight(page, 'Mana')

    await page.locator('.primary-toolbar button', { hasText: 'Copy Link' }).click()

    const tradeUrl = page.url()
    expect(new URL(tradeUrl).hash).toContain('leftSideColIds=')
    expect(new URL(tradeUrl).hash).toContain('rightSideWantedIds=')

    // Navigate to the copied URL fresh
    await page.goto(tradeUrl)

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Sol Ring',
    )
    await expect(page.locator('.trade-col[data-side="right"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
  })

  test('Reset prompts for confirmation, then clears the trade URL params', async ({ page }) => {
    const params = new URLSearchParams()
    params.set('leftSideColIds', 'Trade Collection:4')
    await page.goto(`/#/trade?${params.toString()}`)

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Sol Ring',
    )

    await page.locator('.primary-toolbar button', { hasText: 'Reset' }).click()

    // Cancelling leaves the trade intact.
    await page.locator('.trade-confirm-modal button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.trade-confirm-modal')).toHaveCount(0)
    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Sol Ring',
    )

    // Esc also dismisses the dialog without touching the trade.
    await page.locator('.primary-toolbar button', { hasText: 'Reset' }).click()
    await expect(page.locator('.trade-confirm-modal')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.trade-confirm-modal')).toHaveCount(0)
    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Sol Ring',
    )

    // Confirming clears both columns and the URL params.
    await page.locator('.primary-toolbar button', { hasText: 'Reset' }).click()
    await page.locator('.trade-confirm-modal button', { hasText: 'Clear trade' }).click()
    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toHaveCount(0)
    expect(new URL(page.url()).hash).not.toContain('?')
  })

  test('Update prices refetches Scryfall data and reprices loaded cards only', async ({ page }) => {
    await page.goto('#/trade')

    await addToLeft(page, 'Lightning')

    const leftTotal = page.locator('.trade-col[data-side="left"] .trade-col-foot-total')
    await expect(leftTotal).toContainText('$2.50')

    // Override the collection endpoint to return an updated price for the bolt.
    // Reuses the canonical Lightning Bolt mock and overrides only the usd price
    // so the rest of the card shape stays in sync with what the page expects.
    let collectionRequests = 0
    let requestedIds: string[] = []
    await fulfillJson(page, '**/api.scryfall.com/cards/collection', (route: Route) => {
      collectionRequests++
      const body = route.request().postDataJSON() as { identifiers: { id: string }[] }
      requestedIds = body.identifiers.map((i) => i.id)
      return {
        data: [
          {
            ...MOCK_TRADE_COLLECTION_CARD_BOLT,
            prices: { ...MOCK_TRADE_COLLECTION_CARD_BOLT.prices, usd: '99.99' },
          },
        ],
        not_found: [],
      }
    })

    await page.locator('.primary-toolbar button', { hasText: 'Update prices' }).click()

    await expect(leftTotal).toContainText('$99.99')
    expect(collectionRequests).toBe(1)
    // Only the cards loaded on the page should be requested — Sol Ring is in the
    // collection but not in the trade, so it must NOT be in the request.
    expect(requestedIds).toEqual(['trade-bolt-id'])
  })

  test('Update prices with no cards loaded does not call Scryfall', async ({ page }) => {
    await page.goto('#/trade')

    let collectionRequests = 0
    await fulfillJson(page, '**/api.scryfall.com/cards/collection', () => {
      collectionRequests++
      return { data: [], not_found: [] }
    })

    await page.locator('.primary-toolbar button', { hasText: 'Update prices' }).click()

    await expect(page.locator('.trade-copy-toast')).toContainText('No cards to update')
    expect(collectionRequests).toBe(0)
  })

  test('printing picker: paginates printings 8 at a time', async ({ page }) => {
    const tenPrintings = Array.from({ length: 10 }, (_, i) => ({
      ...PICKER_BASE_PRINTING,
      id: `crypt-${i}`,
      collector_number: `${i + 1}`,
    }))
    await mockPickerPrintings(page, tenPrintings)

    await page.goto('#/trade')
    await scryfallAddToRight(page, 'Mana')

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(8)
    await expect(modal.locator('.trade-picker-pagination-info')).toContainText('Page 1 of 2')

    await modal.locator('button', { hasText: 'Next →' }).click()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(2)
    await expect(modal.locator('.trade-picker-pagination-info')).toContainText('Page 2 of 2')

    // A filter typed on page 2 snaps back to page 1 of the narrowed list —
    // one match here, so the pagination controls disappear entirely.
    await page.keyboard.type(':3')
    await expect(modal.locator('.trade-picker-item')).toHaveCount(1)
    await expect(modal.locator('.trade-picker-pagination-info')).toHaveCount(0)
  })
})
