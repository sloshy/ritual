import { test, expect, type Locator, type Page } from '@playwright/test'
import { holdBuylistQuotes, mockPublicSiteCollectionForSell } from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'
import { gotoList, selectCard } from '../helpers/list-ui'

/**
 * Sell mode on the public site: the toolbar toggle gating buylist prices,
 * filters, grouping and sorting; the selection totals (one of which is
 * deliberately *not* gated on sell mode); and the URL round-trip.
 *
 * Quote matching itself is pinned at the engine layer
 * (test/unit/buylist-quote.test.ts) and the value math in
 * test/unit/sell-value.test.ts — this spec covers only what the UI does with
 * them. The mocked collection holds one actively-bought card, one the buyer has
 * paused, and one they do not stock.
 */

const SELL_TOGGLE = '.toolbar-sell-toggle'

/** Poll the visible list-view card names until they equal `names` (any order). */
async function expectVisibleCards(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(async () => (await page.locator('.list-name').allTextContents()).sort())
    .toEqual([...names].sort())
}

async function gotoSellBinder(page: Page): Promise<void> {
  await gotoList(page, '#/collection/sell-binder')
}

async function switchToListView(page: Page): Promise<void> {
  await page.locator('[data-view="list"]').click()
  await page.waitForSelector('.card-list', { timeout: 10_000 })
}

async function enableSellMode(page: Page): Promise<void> {
  await page.locator(SELL_TOGGLE).click()
  await expect(page.locator(SELL_TOGGLE)).toHaveAttribute('aria-pressed', 'true')
}

/**
 * A buylist filter chip by exact name — "On buylist" is a substring of
 * "Not on buylist", so a `hasText` match is ambiguous.
 */
function buylistChip(panel: Locator, name: string): Locator {
  return panel.locator('.filter-buylist').getByRole('button', { name, exact: true })
}

/** The index of a card in the mocked collection, in file order. */
const CARD_INDEX = { 'Bought Card': 0, 'Paused Card': 1, 'Unlisted Card': 2 } as const

test.describe('Sell mode', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionForSell(page)
  })

  test('the toggle reveals buylist prices, and only for actively-bought cards', async ({
    page,
  }) => {
    await gotoSellBinder(page)
    await switchToListView(page)

    // Off: no buylist figure anywhere, even though quotes exist for two cards.
    await expect(page.locator('.list-buylist-price')).toHaveCount(0)

    await enableSellMode(page)

    // Only the actively-bought card gets a figure. The paused one is on the
    // buylist but worth nothing today, so it renders like an ordinary card.
    await expect(page.locator('.list-buylist-price')).toHaveCount(1)
    await expect(page.locator('.list-buylist-price')).toHaveText('Buy $4.00')
  })

  test('leaving sell mode mid-request stops the toggle reporting busy', async ({ page }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await holdBuylistQuotes(page, held)
    await gotoSellBinder(page)

    const toggle = page.locator(SELL_TOGGLE)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-busy', 'true')

    // The request keeps running, but its result will not be displayed, so the
    // control must stop claiming to be working on the user's behalf.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveAttribute('aria-busy', 'false')
    await expect(toggle.locator('.toolbar-busy-spinner')).toHaveCount(0)

    // Let the held handler finish so it is not torn down mid-fulfill.
    release()
  })

  test('binder tiles carry the same buylist label as the list view', async ({ page }) => {
    await gotoSellBinder(page)
    await enableSellMode(page)

    // Binder is the default view, so this is the label most users actually see;
    // every other price assertion here switches to list view first.
    await expect(page.locator('.card-label-buylist')).toHaveText('Buy $4.00')
  })

  test('the buylist filter narrows to what the buyer stocks', async ({ page }) => {
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    const panel = await openFilterMenu(page)
    await buylistChip(panel, 'On buylist').click()
    // "On buylist" includes the paused card — the buyer has the printing.
    await expectVisibleCards(page, ['Bought Card', 'Paused Card'])

    await buylistChip(panel, 'Not on buylist').click()
    // Both chips selected is an OR covering every card.
    await expectVisibleCards(page, ['Bought Card', 'Paused Card', 'Unlisted Card'])

    await buylistChip(panel, 'On buylist').click()
    await expectVisibleCards(page, ['Unlisted Card'])
  })

  test('the toggle reports it is working while quotes are in flight', async ({ page }) => {
    // A released latch rather than a delay: a retrying assertion would be
    // satisfied by a busy flag that only appeared *after* the response landed,
    // which is the opposite of what this test claims.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await holdBuylistQuotes(page, held)
    await gotoSellBinder(page)
    await switchToListView(page)

    const toggle = page.locator(SELL_TOGGLE)
    await expect(toggle).toHaveAttribute('aria-busy', 'false')

    // Not `enableSellMode`: its awaited assertion would let the busy window
    // close before this test could observe it.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-busy', 'true')
    await expect(toggle).toHaveAttribute('title', /fetching/i)
    await expect(toggle.locator('.toolbar-busy-spinner')).toBeVisible()
    // Busy genuinely means "not answered yet" — the response is still held here.
    await expect(page.locator('.list-buylist-price')).toHaveCount(0)

    release()
    await expect(page.locator('.list-buylist-price')).toHaveText('Buy $4.00')
    await expect(toggle).toHaveAttribute('aria-busy', 'false')
    await expect(toggle.locator('.toolbar-busy-spinner')).toHaveCount(0)
  })

  test('the buylist price filter narrows by the buyer’s offer', async ({ page }) => {
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    const panel = await openFilterMenu(page)
    await panel.locator('#filter-buylist-price').fill('5')
    const comparator = (label: string) =>
      panel.locator('[aria-label="Buylist price comparison"]').getByRole('button', {
        name: label,
        exact: true,
      })
    await comparator('≥').click()
    // Only the $4 offer exists, so a >= $5 threshold clears the list; the paused
    // and unstocked cards were never candidates.
    await expectVisibleCards(page, [])

    await comparator('≤').click()
    await expectVisibleCards(page, ['Bought Card'])
  })

  test('sorting by buylist-vs-price ranks by the gap, not by file order', async ({ page }) => {
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    const sortField = page.locator('.toolbar-sort-layer .toolbar-select').first()
    await sortField.selectOption('buylist-spread')

    // Asserting the reversed order, because the forward order happens to match
    // both the page's default file-order sort and alphabetical order — so a
    // no-op sort field would satisfy it. Reversed, the cards with no computable
    // spread come first, which nothing else produces.
    await page.locator('.toolbar-sort-layer .toolbar-sort-reverse').first().click()
    await expect
      .poll(async () => page.locator('.list-name').allTextContents())
      .toEqual(['Paused Card', 'Unlisted Card', 'Bought Card'])

    await page.locator('.toolbar-sort-layer .toolbar-sort-reverse').first().click()
    await expect
      .poll(async () => page.locator('.list-name').allTextContents())
      .toEqual(['Bought Card', 'Paused Card', 'Unlisted Card'])
  })

  test('leaving sell mode drops the buylist sort and filter it set', async ({ page }) => {
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    const sortField = page.locator('.toolbar-sort-layer .toolbar-select').first()
    await sortField.selectOption('buylist-spread')
    const panel = await openFilterMenu(page)
    await panel.locator('#filter-buylist-price').fill('99')
    await expectVisibleCards(page, [])

    // Both controls vanish with the mode, so neither may keep acting.
    await page.locator(SELL_TOGGLE).click()
    await expectVisibleCards(page, ['Bought Card', 'Paused Card', 'Unlisted Card'])
    await expect(sortField).toHaveValue('file-order')
  })

  test('the buylist filter is unavailable until sell mode is on', async ({ page }) => {
    await gotoSellBinder(page)
    const panel = await openFilterMenu(page)
    await expect(panel.locator('.filter-buylist')).toHaveCount(0)
  })

  test('grouping by on-buylist re-buckets the list', async ({ page }) => {
    await gotoSellBinder(page)
    await enableSellMode(page)

    await page.locator('.toolbar-select').first().selectOption('on-buylist')
    await expect
      .poll(async () => page.locator('.card-section-title, .section-title, h2').allTextContents())
      .toEqual(expect.arrayContaining(['On Buylist', 'Not on Buylist']))
  })

  test('the selected total shows without sell mode; the sell value needs it', async ({ page }) => {
    await gotoSellBinder(page)
    await selectCard(page, CARD_INDEX['Bought Card'])

    const stats = page.locator('.page-stats')
    await expect(stats).toContainText('Selected: $10.00')
    await expect(stats).not.toContainText('Sell value')

    await enableSellMode(page)
    // Two copies wanted, one selected: the whole selection is sellable.
    await expect(stats).toContainText('Sell value: $4.00')
    await expect(stats).not.toContainText('not on buylist')
  })

  test('the sell value names the copies the buyer will not take', async ({ page }) => {
    await gotoSellBinder(page)
    await enableSellMode(page)
    await selectCard(page, CARD_INDEX['Bought Card'])
    await selectCard(page, CARD_INDEX['Paused Card'])
    await selectCard(page, CARD_INDEX['Unlisted Card'])

    const stats = page.locator('.page-stats')
    await expect(stats).toContainText('Sell value: $4.00')
    // The paused card and the unstocked one both produce nothing.
    await expect(stats).toContainText('(2 cards not on buylist)')
  })

  test('the cart export is offered only in sell mode', async ({ page }) => {
    await gotoSellBinder(page)

    const copyButton = page.locator('.export-menu-control').first().locator('button')
    await copyButton.click()
    await expect(page.locator('.selection-menu-item', { hasText: 'cart' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await enableSellMode(page)
    await copyButton.click()
    await expect(
      page.locator('.selection-menu-item', { hasText: 'Card Kingdom cart (.csv)' }),
    ).toBeVisible()
  })

  test('sell-mode state survives a reload through the URL', async ({ page }) => {
    await gotoSellBinder(page)
    await enableSellMode(page)
    const panel = await openFilterMenu(page)
    await buylistChip(panel, 'On buylist').click()

    await expect
      .poll(() => {
        const params = new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '')
        return {
          sell: params.get('sell'),
          buyer: params.get('buyer'),
          buylist: params.get('buylist'),
        }
      })
      .toEqual({ sell: '1', buyer: 'cardkingdom', buylist: 'on' })

    await page.reload()
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await expect(page.locator(SELL_TOGGLE)).toHaveAttribute('aria-pressed', 'true')
    await switchToListView(page)
    await expectVisibleCards(page, ['Bought Card', 'Paused Card'])
  })
})
