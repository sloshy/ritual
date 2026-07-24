import { test, expect, type Page } from '@playwright/test'
import type { DeckDetail } from '../../../src/site/data-types'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard, withImage } from '../helpers/mock-cards'
import { makeSiteIndex, makeDeckSummary, mockPublicSiteForTrade } from '../helpers/mock-public-site'
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

/** A card no mocked list holds — reachable only through the backend's card cache. */
const MANA_VAULT = withImage(
  makeMockScryfallCard({
    id: 'mana-vault-id',
    name: 'Mana Vault',
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: '40.00' },
    set: 'vma',
    set_name: 'Vintage Masters',
    collector_number: '292',
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

  test('trade search covers wanted lists and the card cache, with no Scryfall toggle', async ({
    page,
  }) => {
    await mockPublicSiteForTrade(page, { apiBaseUrl: '' })
    const scryfallRequests = collectScryfallRequests(page)

    await fulfillJson(page, '**/api/autocomplete*', (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? ''
      // The cache holds every card, not just the ones the lists mention.
      return { success: true, names: q === 'mana' ? ['Mana Crypt', 'Mana Vault'] : [] }
    })
    // Answers only for the name asked about, so the picker's contents prove which
    // suggestion was selected.
    await fulfillJson(page, '**/api/card-printings*', (route) => {
      const name = new URL(route.request().url()).searchParams.get('name') ?? ''
      return { success: true, printings: name === 'Mana Vault' ? [MANA_VAULT] : [] }
    })

    await page.goto('#/trade')
    const right = page.locator('.trade-col[data-side="right"]')
    // Asserted before the toggle's absence below, which would pass vacuously on a
    // page that hasn't rendered the column yet.
    await expect(right.locator('.source-pill')).toContainText('Wanted List + Card Cache')

    // The toggle has nothing left to switch between, so it gives way to a note.
    await expect(right.locator('.search-mode-toggle')).toHaveCount(0)
    await expect(right.locator('.search-mode-note')).toContainText("hosted API's card cache")

    await right.locator('.search-input').fill('mana')
    const rows = right.locator('.search-suggest-row')
    // The wanted list's own Mana Crypt leads, then the cache's matches in the
    // order the server ranked them (the live path forwards `names` verbatim).
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('from Trade Wanted List')
    await expect(rows.nth(1)).toContainText('Mana Crypt')
    await expect(rows.nth(1)).toContainText('Card cache')
    await expect(rows.nth(2)).toContainText('Mana Vault')

    // Mana Vault is in no list at all — before the cache was searched, typing its
    // name here found nothing.
    await rows.nth(2).click({ force: true })
    const modal = page.locator('.trade-picker-modal')
    await expect(modal.locator('.trade-picker-title')).toContainText('Mana Vault')
    await modal.locator('.trade-picker-item').first().click()
    await modal.locator('button', { hasText: 'Add to Trade' }).click()
    await expect(modal).not.toBeVisible()

    const row = right.locator('.trade-row').first()
    await expect(row.locator('.trade-row-name-text')).toContainText('Mana Vault')
    // The chosen printing came through, not just its name.
    await expect(row.locator('.trade-row-name-meta')).toContainText('VMA:292')
    // The row is still encoded by Scryfall ID, but its data came from the
    // backend's cache, and it says so.
    await expect(row.locator('.src-tag')).toHaveText('Cache')
    expect(scryfallRequests).toEqual([])
  })

  test('a shared trade link resolves its cards through the API, not Scryfall', async ({ page }) => {
    await mockPublicSiteForTrade(page, { apiBaseUrl: '' })
    const scryfallRequests = collectScryfallRequests(page)

    const idsAsked: string[] = []
    await fulfillJson(page, '**/api/cards*', (route) => {
      const ids = new URL(route.request().url()).searchParams.get('ids') ?? ''
      idsAsked.push(ids)
      return { success: true, cards: ids.includes('mana-vault-id') ? [MANA_VAULT] : [] }
    })

    // A link someone shared: one row that belongs to no list, encoded by ID.
    await page.goto('#/trade?rightSideScryfall=x2@mana-vault-id')

    const row = page.locator('.trade-col[data-side="right"] .trade-row').first()
    await expect(row.locator('.trade-row-name-text')).toContainText('Mana Vault')
    await expect(row.locator('.trade-row-name-meta')).toContainText('VMA:292')
    await expect(row.locator('.src-tag')).toHaveText('Cache')
    // Both copies the link asked for.
    await expect(row.locator('.qty-val')).toContainText('2')
    expect(idsAsked).toEqual(['mana-vault-id'])
    expect(scryfallRequests).toEqual([])
  })

  test('a backend that dies mid-session hands the trade page its Scryfall toggle back', async ({
    page,
  }) => {
    await mockPublicSiteForTrade(page, { apiBaseUrl: 'https://api.test' })
    // The live index still loads, so the page boots hosted; the list fetches the
    // trade page makes next are what die, tripping the degrade under it.
    await page.route('https://api.test/collections/**', (route) => route.abort())
    await page.route('https://api.test/wanted/**', (route) => route.abort())

    await page.goto('#/trade')
    const right = page.locator('.trade-col[data-side="right"]')
    await expect(page.locator('.site-live-badge')).toHaveText('Offline', { timeout: 15_000 })

    await expect(right.locator('.source-pill')).toContainText('Wanted List')
    await expect(right.locator('.search-mode-note')).toHaveCount(0)
    await expect(right.locator('.search-mode-toggle')).toContainText('Search Scryfall instead')
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
