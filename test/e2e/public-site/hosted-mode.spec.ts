import { test, expect, type Page } from '@playwright/test'
import type { DeckDetail } from '../../../src/site/data-types'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard, withImage } from '../helpers/mock-cards'
import { makeSiteIndex, makeDeckSummary } from '../helpers/mock-public-site'
import { disableSearchDebounce } from '../helpers/search-modal'
import { enterEditMode } from '../helpers/list-ui'

/**
 * The hosted public site: when index.json carries an `apiBaseUrl`, list data is
 * fetched live, the editor's card search goes through the backend's cache-backed
 * term matching (no Scryfall, no source note), prices refresh through the batch
 * endpoint, and a dead remote backend degrades the whole app to the baked data.
 */

const CREATURE = withImage(
  makeMockScryfallCard({
    id: 'creature-id',
    name: 'Test Creature',
    cmc: 2,
    type_line: 'Creature — Human',
    mana_cost: '{1}{W}',
    prices: { usd: '1.00' },
    collector_number: '1',
  }),
)

const TRENCHES = withImage(
  makeMockScryfallCard({
    id: 'trenches-id',
    name: 'In the Trenches',
    cmc: 3,
    type_line: 'Enchantment',
    prices: { usd: '0.50' },
    collector_number: '2',
  }),
)

function hostedDeckDetail(): DeckDetail {
  return {
    deck: {
      name: 'Hosted Deck',
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Test Creature' }] }],
    },
    cards: { 'Test Creature': CREATURE },
    printings: { 'Test Creature': [CREATURE] },
    symbolMap: {},
    useScryfallImgUrls: false,
    defaultCurrency: 'usd',
    availableCurrencies: ['usd'],
  }
}

const HOSTED_INDEX = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'hosted-deck', name: 'Hosted Deck' })],
  // Same-origin marker, as `ritual serve --api` emits it.
  apiBaseUrl: '',
})

async function mockHostedDeck(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', HOSTED_INDEX)
  await fulfillJson(page, '**/decks/hosted-deck.json', hostedDeckDetail())
}

/** Collect every request the page makes to Scryfall — the hosted mode must make none. */
function collectScryfallRequests(page: Page): string[] {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('api.scryfall.com')) requests.push(request.url())
  })
  return requests
}

test.describe('Hosted public site', () => {
  test('add-card search uses the backend term matching without a Scryfall note', async ({
    page,
  }) => {
    await disableSearchDebounce(page)
    await mockHostedDeck(page)
    const scryfallRequests = collectScryfallRequests(page)

    await fulfillJson(page, '**/api/autocomplete*', (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? ''
      // The backend's term matching finds "In the Trenches" for "in tre" —
      // Scryfall's contiguous matching never would.
      return { success: true, names: q === 'in tre' ? ['In the Trenches'] : [] }
    })
    await fulfillJson(page, '**/api/card-printings*', { success: true, printings: [TRENCHES] })

    await page.goto('#/deck/hosted-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await expect(page.locator('.site-live-badge')).toHaveText('Live')

    await enterEditMode(page)
    await page.locator('.btn-add').click()
    const searchInput = page.locator('.search-modal input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })

    // No Scryfall disclosure in hosted mode — the semantics match the admin editor.
    await expect(page.locator('.search-source-note')).toHaveCount(0)

    await searchInput.fill('in tre')
    const result = page.locator('.search-result-item', { hasText: 'In the Trenches' })
    await expect(result).toBeVisible({ timeout: 5_000 })

    // Selecting it advances to the printing step, served from the API too.
    await result.click()
    await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
      timeout: 5_000,
    })

    expect(scryfallRequests).toEqual([])
  })

  test('list data is refetched from the backend on navigation', async ({ page }) => {
    await fulfillJson(page, '**/index.json', HOSTED_INDEX)
    let visits = 0
    await fulfillJson(page, '**/decks/hosted-deck.json', () => {
      visits += 1
      const detail = hostedDeckDetail()
      if (visits > 1) {
        // Simulates an admin/CLI edit landing between visits: no rebuild, the
        // next fetch simply serves the new contents.
        detail.deck.sections[0]!.cards.push({ quantity: 1, name: 'In the Trenches' })
        detail.cards['In the Trenches'] = TRENCHES
        detail.printings['In the Trenches'] = [TRENCHES]
      }
      return detail
    })

    await page.goto('#/deck/hosted-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await expect(page.locator('.card-item')).toHaveCount(1)

    // Leave and return in-SPA (hash navigation preserves module state).
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await expect(page.locator('.deck-cover')).toBeVisible()
    await page.evaluate(() => {
      window.location.hash = '#/deck/hosted-deck'
    })

    await expect(page.locator('.card-item')).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('.card-item', { hasText: 'In the Trenches' })).toBeVisible()
  })

  test('a remote backend serves live data and shows the Live badge', async ({ page }) => {
    const bakedIndex = makeSiteIndex({
      decks: [makeDeckSummary({ slug: 'hosted-deck', name: 'Baked Deck' })],
      apiBaseUrl: 'https://api.test',
    })
    // Both the baked (relative) and live (https://api.test) index.json match
    // this glob; branch on the origin.
    await fulfillJson(page, '**/index.json', (route) =>
      route.request().url().startsWith('https://api.test')
        ? makeSiteIndex({
            decks: [makeDeckSummary({ slug: 'hosted-deck', name: 'Live Deck' })],
            apiBaseUrl: 'https://api.test',
          })
        : bakedIndex,
    )

    await page.goto('#/')
    await expect(page.locator('.site-live-badge')).toHaveText('Live')
    await expect(page.locator('.deck-cover')).toContainText('Live Deck')
  })

  test('a dead remote backend degrades to the baked data with an Offline badge', async ({
    page,
  }) => {
    await fulfillJson(
      page,
      '**/index.json',
      makeSiteIndex({
        decks: [makeDeckSummary({ slug: 'hosted-deck', name: 'Baked Deck' })],
        apiBaseUrl: 'https://api.test',
      }),
    )
    // Registered after the fulfill, so it takes precedence for the API origin.
    await page.route('https://api.test/**', (route) => route.abort())

    await page.goto('#/')
    await expect(page.locator('.site-live-badge')).toHaveText('Offline', { timeout: 15_000 })
    await expect(page.locator('.deck-cover')).toContainText('Baked Deck')
  })

  test('Update Prices goes through the batch API endpoint, not Scryfall', async ({ page }) => {
    await mockHostedDeck(page)
    const scryfallRequests = collectScryfallRequests(page)

    await fulfillJson(
      page,
      '**/api/card-prices',
      {
        success: true,
        cards: [{ ...CREATURE, prices: { ...CREATURE.prices, usd: '10.00' } }],
      },
      { method: 'POST' },
    )

    await page.goto('#/deck/hosted-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
    await expect(page.locator('.page-stats')).toContainText('1.00')

    await page.locator('.btn-update-prices').click()
    await expect(page.locator('.page-stats')).toContainText('10.00')

    expect(scryfallRequests).toEqual([])
  })
})
