import { test, expect, type Page } from '@playwright/test'
import type { BuylistQuoteRequest, BuylistQuotesResponse } from '../../../src/buylist'
import type { BuylistQuoteBody } from '../../../src/api/buylist'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openAdminPage, openDeckWithCards } from '../helpers/editor-nav'
import {
  mockCacheRefreshApi,
  emitStreamEvent,
  mockBuylistApi,
  mockStatusApi,
} from '../helpers/mock-admin'
import { SYNTHETIC_DECK_SLUG } from '../helpers/synthetic-workspace'
import { fulfillJson } from '../helpers/fulfill'

test.describe('Cache Refresh Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
    await openAdminPage(page, 'Refresh Cache')
  })

  test('clicking refresh shows progress stages then completion', async ({ page }) => {
    await mockCacheRefreshApi(page)
    const main = page.locator('main')
    await main.locator('button:has-text("Refresh Cache")').click()

    await emitStreamEvent(page, 'progress', {
      stage: 'download',
      percentage: 50,
      message: 'Downloading: 50% (36.25/72.50 MiB)',
    })
    await expect(main.locator('.progress-stages')).toBeVisible({ timeout: 5000 })
    // The streamed pipeline has exactly two stages: the download (which parses
    // and processes cards as bytes arrive) and the cache save.
    await expect(main.locator('.progress-stage')).toHaveCount(2)
    await expect(main.locator('.progress-stage[data-status="active"]')).toContainText(
      'Downloading & processing card data',
    )

    await emitStreamEvent(page, 'progress', {
      stage: 'save',
      message: 'Saving to cache...',
    })
    await expect(main.locator('.progress-stage[data-status="done"]')).toContainText(
      'Downloading & processing card data',
    )
    await expect(main.locator('.progress-stage[data-status="active"]')).toContainText(
      'Saving to cache',
    )

    await emitStreamEvent(page, 'done', { message: 'Cache refreshed successfully' })
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    // Completion collapses the progress UI and re-enables the button.
    await expect(main.locator('.progress-stages')).toHaveCount(0)
    await expect(main.locator('button:has-text("Refresh Cache")')).toBeEnabled()
  })
})

test.describe('Cache Refresh Page — Card Kingdom buylist', () => {
  // The card fetches its status on mount, so the route must be intercepted
  // before the page is opened — unlike the cache-refresh stream above, which is
  // only reached on click. Hence: land on the dashboard, install the mock, then
  // navigate to the page.
  const openCacheRefresh = (page: Page): Promise<void> => openAdminPage(page, 'Refresh Cache')

  /** The synthetic deck every re-quote case appraises. */
  const DECK_SLUG = 'emberwild-aggro'

  /**
   * Answer `POST /api/buylist/quotes` and record the printings each call asked
   * about. The bodies, not a bare count: what makes a re-quote test about the
   * store's reset rather than about a request tally is that the *same*
   * printings were asked a second time.
   */
  async function recordQuoteRequests(page: Page): Promise<BuylistQuoteRequest[][]> {
    const asked: BuylistQuoteRequest[][] = []
    await fulfillJson(
      page,
      '**/api/buylist/quotes',
      (route): BuylistQuotesResponse => {
        const body = route.request().postDataJSON() as BuylistQuoteBody
        asked.push(body.printings)
        return {
          success: true,
          buyer: 'cardkingdom',
          quotes: {},
          feedCreatedAt: '2026-08-04 06:06:09',
          feedRetrievedAt: 1785850800000,
          stale: false,
          productCount: 149978,
        }
      },
      { method: 'POST' },
    )
    return asked
  }

  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  test('the buylist card reports the cached feed and refreshes it on demand', async ({ page }) => {
    await mockBuylistApi(page)
    await openCacheRefresh(page)
    const card = page.locator('.cache-card')
    await expect(card).toContainText('Card Kingdom buylist')
    await expect(card.locator('.cache-card-facts')).toContainText('149,978')

    await card.locator('button:has-text("Refresh buylist")').click()
    await expect(card.locator('.cache-card-status')).toContainText('Buylist updated')
  })

  test('a workspace with no buylist yet shows an empty state, not an error', async ({ page }) => {
    await mockBuylistApi(page, 'missing')
    await openCacheRefresh(page)
    const card = page.locator('.cache-card')
    // The 503 is the normal first-run state: offer the button, don't alarm.
    await expect(card.locator('.cache-card-empty')).toContainText('No buylist has been downloaded')
    await expect(card.locator('.cache-card-error')).toHaveCount(0)
    await expect(card.locator('button:has-text("Refresh buylist")')).toBeEnabled()
  })

  test('a refresh that brings down a new feed makes the editors re-quote', async ({ page }) => {
    // Quotes are answered (rather than left to the real server, whose synthetic
    // workspace has no feed) because only a *settled* printing is never asked
    // about again — a failed request is retried anyway, which would make the
    // second request below prove nothing.
    const asked = await recordQuoteRequests(page)
    await mockBuylistApi(page)

    await openDeckWithCards(page, DECK_SLUG)
    await page.locator('.toolbar-sell-toggle').click()
    // The mode actually landed, so the request below is the engage's and not a
    // stray from some other effect.
    await expect(page.locator('#buylist-buyer')).toHaveCount(1)
    await expect.poll(() => asked.length).toBe(1)

    await openCacheRefresh(page)
    await page.locator('.cache-card button:has-text("Refresh buylist")').click()
    await expect(page.locator('.cache-card-status')).toContainText('Buylist updated')

    // Sell mode is a global mode, so reopening the editor quotes its cards
    // again — and the refresh dropped every quote already resolved in this
    // session, so those printings are asked about a second time. Without that
    // reset they stay settled and this editor would price the old feed forever.
    await openDeckWithCards(page, DECK_SLUG)
    await expect.poll(() => asked.length).toBe(2)
    // The identity of the second request is the whole point: the *same*
    // printings, re-asked against the feed just downloaded. A bare count is
    // satisfied by any stray duplicate.
    expect(asked[1]).toEqual(asked[0])
  })

  test('a refresh that changed nothing leaves the session’s quotes settled', async ({ page }) => {
    // The other side of the `if (data.refreshed)` gate: a still-fresh copy
    // changed no feed on disk, so the store is already quoting exactly it and
    // dropping every settled key would only buy a round of identical requests.
    const asked = await recordQuoteRequests(page)
    await mockBuylistApi(page, 'present', { refreshed: false })

    await openDeckWithCards(page, DECK_SLUG)
    await page.locator('.toolbar-sell-toggle').click()
    await expect(page.locator('#buylist-buyer')).toHaveCount(1)
    await expect.poll(() => asked.length).toBe(1)

    await openCacheRefresh(page)
    await page.locator('.cache-card button:has-text("Refresh buylist")').click()
    // The card words a clean run the same either way — the outcome that differs
    // is below, in what the store still holds.
    await expect(page.locator('.cache-card-status')).toContainText('Buylist updated')

    // Ordering by a *guaranteed later request*, not a sleep: the second deck
    // carries printings this session never settled (Sol Ring, Counterspell),
    // so opening it must issue exactly one new request — which arrives after
    // any re-ask the reopened first deck would wrongly have made. A reset here
    // would read as length 3, or as asked[1] repeating asked[0].
    await openDeckWithCards(page, DECK_SLUG)
    await expect(page.locator('.card-item').first()).toBeVisible()
    await openDeckWithCards(page, SYNTHETIC_DECK_SLUG)
    await expect.poll(() => asked.length).toBe(2)
    expect(asked[1]).not.toEqual(asked[0])
  })

  test('a refresh that fell back to the stale feed reports it was not updated', async ({
    page,
  }) => {
    // The third outcome: the download failed and the older feed stayed in
    // place. Reported as a warning rather than an error — the card still has
    // prices to show — and it must not reset the store either.
    const asked = await recordQuoteRequests(page)
    await mockBuylistApi(page, 'present', {
      refreshed: false,
      warnings: ['Card Kingdom pricelist download failed; using the cached feed.'],
    })

    await openDeckWithCards(page, DECK_SLUG)
    await page.locator('.toolbar-sell-toggle').click()
    await expect(page.locator('#buylist-buyer')).toHaveCount(1)
    await expect.poll(() => asked.length).toBe(1)

    await openCacheRefresh(page)
    const card = page.locator('.cache-card')
    await card.locator('button:has-text("Refresh buylist")').click()
    await expect(card.locator('.cache-card-status')).toContainText('was not updated')

    // Same guaranteed-later-request ordering as the still-fresh case above.
    await openDeckWithCards(page, DECK_SLUG)
    await expect(page.locator('.card-item').first()).toBeVisible()
    await openDeckWithCards(page, SYNTHETIC_DECK_SLUG)
    await expect.poll(() => asked.length).toBe(2)
    expect(asked[1]).not.toEqual(asked[0])
  })

  test('a server without sell mode does not offer the buylist card at all', async ({ page }) => {
    // The e2e admin server runs with `--sell-mode`; this is the other server,
    // faked at its boot payload. Its sell routes 404, so a card whose every
    // button would fail must not be rendered.
    await mockStatusApi(page)
    await mockBuylistApi(page)
    // Re-navigate so the app boots against the faked status.
    await gotoAdminDashboard(page)
    await openCacheRefresh(page)

    // The Scryfall half is the control: the page rendered, the buylist card is
    // the only thing withheld.
    await expect(page.locator('main button:has-text("Refresh Cache")')).toBeVisible()
    await expect(page.locator('.cache-card')).toHaveCount(0)
  })
})
