import { test, expect, type Locator, type Page } from '@playwright/test'
import { mockPublicSiteCollectionForSell, type BuylistApiWatch } from '../helpers/mock-public-site'
import { openFilterMenu } from '../helpers/filter-menu'
import { gotoList, selectCard } from '../helpers/list-ui'

/**
 * Sell mode on the public site: the toolbar toggle gating buylist prices,
 * filters, grouping and sorting; the selection totals (one of which is
 * deliberately *not* gated on sell mode); and the URL round-trip.
 *
 * The mocked site is a plain static build — no `apiBaseUrl`, no quote API —
 * whose collection carries the offers baked in by `build-site --sell-mode`.
 * Every buylist route is intercepted and failed, so any test here also proves
 * the page never asks for a quote.
 *
 * Quote matching itself is pinned at the engine layer
 * (test/unit/buylist-quote.test.ts), the baking in
 * test/unit/site/details.test.ts, the store seeding in
 * test/unit/site/buylist-seed.test.ts, and the value math in
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
 * Queue `requestAnimationFrame` callbacks instead of running them, so a test can
 * hold the page inside a deferral. Must be installed before navigation.
 */
async function holdFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const queued: FrameRequestCallback[] = []
    window.requestAnimationFrame = (callback) => queued.push(callback)
    window.cancelAnimationFrame = (handle) => {
      queued[handle - 1] = () => {}
    }
    Object.assign(window, { __runFrames: () => queued.splice(0).forEach((cb) => cb(0)) })
  })
}

/** Run every held frame callback, plus the task each one schedules. */
async function releaseFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        ;(window as unknown as { __runFrames: () => void }).__runFrames()
        setTimeout(resolve, 0)
      }),
  )
}

/**
 * A buylist filter chip, scoped to its group and matched by accessible name.
 * `exact` also pins the casing.
 */
function buylistChip(panel: Locator, name: string): Locator {
  return panel
    .getByRole('group', { name: 'Buylist filter' })
    .getByRole('button', { name, exact: true })
}

/** The index of a card in the mocked collection, in file order. */
const CARD_INDEX = { 'Bought Card': 0, 'Paused Card': 1, 'Unlisted Card': 2 } as const

test.describe('Sell mode', () => {
  let buylistApi: BuylistApiWatch

  test.beforeEach(async ({ page }) => {
    buylistApi = await mockPublicSiteCollectionForSell(page)
  })

  test('the toggle reveals baked buylist prices, without asking any API', async ({ page }) => {
    await gotoSellBinder(page)
    await switchToListView(page)

    // Off: no buylist figure anywhere, even though quotes are baked for two cards.
    await expect(page.locator('.list-buylist-price')).toHaveCount(0)

    await enableSellMode(page)

    // Only the actively-bought card gets a figure. The paused one is on the
    // buylist but worth nothing today, so it renders like an ordinary card.
    await expect(page.locator('.list-buylist-price')).toHaveCount(1)
    await expect(page.locator('.list-buylist-price')).toHaveText('Buy $4.00')
    // The prices came out of the list payload: a static host has nothing to
    // answer `POST /api/buylist/quotes` with.
    expect(buylistApi.requests).toEqual([])
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

  test('the toggle reports the click before the mode itself turns on', async ({ page }) => {
    // Sell mode is deferred to after a paint (see `engageSellMode`) so the
    // button's own transition is not stuck behind the whole list rebuilding.
    // Holding the frame queue is what makes that window observable: without it
    // the flip lands within a retrying assertion's first poll, and a toggle that
    // waited for the rebuild would look identical to one that did not.
    await holdFrames(page)
    await gotoSellBinder(page)

    const toggle = page.locator(SELL_TOGGLE)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // The mode has *not* flipped: its buyer selector is not rendered yet.
    await expect(page.locator('#buylist-buyer')).toHaveCount(0)

    await releaseFrames(page)
    await expect(page.locator('#buylist-buyer')).toHaveCount(1)
  })

  test('a second click during that window turns sell mode back off', async ({ page }) => {
    await holdFrames(page)
    await gotoSellBinder(page)

    const toggle = page.locator(SELL_TOGGLE)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // The button says pressed, so clicking it must un-press it — the pending
    // flip belongs to a click the user has now taken back.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await releaseFrames(page)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('#buylist-buyer')).toHaveCount(0)
  })

  test('the buylist price filter narrows by the buyer’s offer', async ({ page }) => {
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    const panel = await openFilterMenu(page)
    await panel.locator('#filter-buylist-price').fill('5')
    const comparator = (label: string) =>
      panel.getByRole('group', { name: 'Buylist price comparison' }).getByRole('button', {
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

    // Spreads are $4−$10, $0−$20 and $0−$30, so ascending puts the card the
    // buyer pays closest to retail for last — the exact inverse of the page's
    // default file-order sort, which no no-op sort field could produce.
    await expect
      .poll(async () => page.locator('.list-name').allTextContents())
      .toEqual(['Unlisted Card', 'Paused Card', 'Bought Card'])

    await page.locator('.toolbar-sort-layer .toolbar-sort-reverse').first().click()
    await expect
      .poll(async () => page.locator('.list-name').allTextContents())
      .toEqual(['Bought Card', 'Paused Card', 'Unlisted Card'])
  })

  test('the group control keeps naming the current grouping when the dropdown grows', async ({
    page,
  }) => {
    await gotoSellBinder(page)
    const groupField = page.locator('.toolbar-select').first()
    await groupField.selectOption('cmc')

    await enableSellMode(page)
    // Wait for the mode to actually land: `enableSellMode` returns while the
    // button is only *pressed*, which is before the deferred flip rebuilds the
    // option list this test is about.
    await expect(groupField.locator('option')).toHaveCount(7)

    // Entering sell mode changes neither the grouping nor the control naming it.
    await expect(groupField).toHaveValue('cmc')
    await expect(page.locator('.section-divider h2')).toHaveText('2')
  })

  test('leaving sell mode swaps the buylist sort for price and drops the filter', async ({
    page,
  }) => {
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    const sortField = page.locator('.toolbar-sort-layer .toolbar-select').first()
    await sortField.selectOption('buylist-spread')
    const panel = await openFilterMenu(page)
    await panel.locator('#filter-buylist-price').fill('99')
    await expectVisibleCards(page, [])

    // Both controls vanish with the mode, so neither may keep acting — but the
    // sort survives as its ordinary equivalent rather than being thrown away.
    await page.locator(SELL_TOGGLE).click()
    await expectVisibleCards(page, ['Bought Card', 'Paused Card', 'Unlisted Card'])
    await expect(sortField).toHaveValue('price')
  })

  test('the buylist filter is unavailable until sell mode is on', async ({ page }) => {
    await gotoSellBinder(page)
    const panel = await openFilterMenu(page)
    // The Color group is a control: it proves the panel's groups are reachable,
    // so the two absences below mean "withheld", not "role lookup found nothing".
    await expect(panel.getByRole('group', { name: 'Color match mode' })).toHaveCount(1)
    await expect(panel.getByRole('group', { name: 'Buylist filter' })).toHaveCount(0)
    // The same prop gates the buylist price row.
    await expect(panel.locator('#filter-buylist-price')).toHaveCount(0)
  })

  test('grouping by on-buylist re-buckets the list', async ({ page }) => {
    await gotoSellBinder(page)
    await enableSellMode(page)

    const groupField = page.locator('.toolbar-select').first()
    await groupField.selectOption('on-buylist')
    await expect
      .poll(async () => page.locator('.section-divider h2').allTextContents())
      .toEqual(expect.arrayContaining(['On Buylist', 'Not on Buylist']))

    // Leaving the mode takes the grouping with it: the option disappears, so the
    // list falls back to the page's default grouping and the control says so.
    await page.locator(SELL_TOGGLE).click()
    await expect(groupField).toHaveValue('none')
    await expect(page.locator('.section-divider h2')).toHaveText('All Cards')
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

  test('a list built without a buylist explains itself instead of showing no prices', async ({
    page,
  }) => {
    // Sell mode on with no buyer feed to quote against: the build still stamps
    // `sellMode: true`, so the toggle is offered — and every card would read as
    // "not on the buylist", indistinguishable from a genuine decline, without
    // the notice.
    // Re-registered, so the later route wins and the watch this test asserts on
    // is the live one.
    buylistApi = await mockPublicSiteCollectionForSell(page, { baked: false })
    await gotoSellBinder(page)
    await switchToListView(page)
    await enableSellMode(page)

    await expect(page.locator('.page-stats-warning')).toContainText(
      'this list was built without buylist data',
    )
    await expect(page.locator('.list-buylist-price')).toHaveCount(0)
    // Still no round trip: a static host has nothing to answer with either way.
    expect(buylistApi.requests).toEqual([])
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
