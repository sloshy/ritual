import { test, expect } from '@playwright/test'
import { mockPublicSiteForTrade } from '../helpers/mock-data'

const PICKER_BASE_PRINTING = {
  id: 'crypt-base',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  oracle_text: '',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: {
    usd: '175.00',
    usd_foil: null,
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null,
  },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
  color_identity: [],
  released_at: '2020-08-07',
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

  test('navigating to #/trade shows the two-column layout', async ({ page }) => {
    await page.goto('#/trade')
    await expect(page.locator('.trade-col[data-side="left"]')).toBeVisible()
    await expect(page.locator('.trade-col[data-side="right"]')).toBeVisible()
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

  test('left column: removing a card removes it from the list', async ({ page }) => {
    await page.goto('#/trade')

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')
    const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest).toBeVisible()
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Lightning Bolt',
    )

    await page.locator('.trade-col[data-side="left"] .trade-row-remove').first().click()

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toHaveCount(0)
  })

  test('left column: price total updates after adding a card', async ({ page }) => {
    await page.goto('#/trade')

    await expect(page.locator('.trade-col[data-side="left"] .trade-col-foot-total')).toContainText(
      '—',
    )

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')
    const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest).toBeVisible()
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    await expect(
      page.locator('.trade-col[data-side="left"] .trade-col-foot-total'),
    ).not.toContainText('—')
  })

  test('left column: sort controls toggle between name and price', async ({ page }) => {
    await page.goto('#/trade')

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')
    const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest).toBeVisible()
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    await leftSearch.fill('Sol')
    const suggest2 = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest2).toBeVisible()
    await suggest2.locator('.search-suggest-row').first().click({ force: true })

    await page.locator('.trade-col[data-side="left"] .toolbar-seg', { hasText: 'Price' }).click()
    await expect(page.locator('.trade-col[data-side="left"] .toolbar-seg.active')).toContainText(
      'Price',
    )

    await page.locator('.trade-col[data-side="left"] .toolbar-seg', { hasText: 'Name' }).click()
    await expect(page.locator('.trade-col[data-side="left"] .toolbar-seg.active')).toContainText(
      'Name',
    )
  })

  test('right column: searching and adding a card from the wanted list', async ({ page }) => {
    await page.goto('#/trade')

    const rightSearch = page.locator('.trade-col[data-side="right"] .search-input')
    await rightSearch.fill('Mana')

    const suggest = page.locator('.trade-col[data-side="right"] .search-suggest')
    await expect(suggest).toBeVisible()
    const firstRow = suggest.locator('.search-suggest-row').first()
    await expect(firstRow).toContainText('Mana Crypt')

    await firstRow.click({ force: true })

    await expect(page.locator('.trade-col[data-side="right"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
  })

  test('right column: toggling Scryfall mode changes the placeholder', async ({ page }) => {
    await page.goto('#/trade')

    const rightColumn = page.locator('.trade-col[data-side="right"]')
    const searchInput = rightColumn.locator('.search-input')

    await expect(searchInput).toHaveAttribute('placeholder', /wanted/i)

    await rightColumn.locator('.search-mode-toggle').click()

    await expect(searchInput).toHaveAttribute('placeholder', /scryfall/i)
  })

  test('right column: Scryfall mode shows autocomplete from Scryfall API', async ({ page }) => {
    await page.goto('#/trade')

    const rightColumn = page.locator('.trade-col[data-side="right"]')

    await rightColumn.locator('.search-mode-toggle').click()

    const searchInput = rightColumn.locator('.search-input')
    await searchInput.fill('Mana')

    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await expect(suggest.locator('.search-suggest-row').first()).toContainText('Mana Crypt')
  })

  test('right column: Scryfall mode opens printing picker on card name select', async ({
    page,
  }) => {
    await page.goto('#/trade')

    const rightColumn = page.locator('.trade-col[data-side="right"]')
    await rightColumn.locator('.search-mode-toggle').click()

    const searchInput = rightColumn.locator('.search-input')
    await searchInput.fill('Mana')

    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    await expect(page.locator('.trade-picker-modal')).toBeVisible()
    await expect(page.locator('.trade-picker-title')).toContainText('Mana Crypt')
  })

  test('printing picker: selecting a printing and clicking Add adds to right column', async ({
    page,
  }) => {
    await page.goto('#/trade')

    const rightColumn = page.locator('.trade-col[data-side="right"]')
    await rightColumn.locator('.search-mode-toggle').click()

    const searchInput = rightColumn.locator('.search-input')
    await searchInput.fill('Mana')
    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await modal.locator('.trade-picker-item').first().click()

    await modal.locator('button', { hasText: 'Add to Trade' }).click()

    await expect(page.locator('.trade-picker-modal')).not.toBeVisible()
    await expect(page.locator('.trade-col[data-side="right"] .trade-row-name-text')).toContainText(
      'Mana Crypt',
    )
  })

  test('printing picker: pressing Escape closes the picker', async ({ page }) => {
    await page.goto('#/trade')

    const rightColumn = page.locator('.trade-col[data-side="right"]')
    await rightColumn.locator('.search-mode-toggle').click()

    await rightColumn.locator('.search-input').fill('Mana')
    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    await expect(page.locator('.trade-picker-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.trade-picker-modal')).not.toBeVisible()
  })

  test('left column: stepper hidden for single-copy cards', async ({ page }) => {
    await page.goto('#/trade')

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Sol')
    const suggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(suggest).toBeVisible()
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    const row = page.locator('.trade-col[data-side="left"] .trade-row').first()
    await expect(row.locator('.qty-stepper')).toHaveCount(0)
    await expect(row.locator('.qty-val-fixed')).toContainText('1')
  })

  test('left column: stepper caps at collection maxQty', async ({ page }) => {
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

    const rightColumn = page.locator('.trade-col[data-side="right"]')
    await rightColumn.locator('.search-mode-toggle').click()

    const searchInput = rightColumn.locator('.search-input')
    await searchInput.fill('Mana')
    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

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

  test('printing picker: filter by set code narrows the list', async ({ page }) => {
    const printings = [
      { ...PICKER_BASE_PRINTING, id: 'a', set: '2xm' },
      { ...PICKER_BASE_PRINTING, id: 'b', set: 'mkm' },
      { ...PICKER_BASE_PRINTING, id: 'c', set: 'lea' },
    ]
    await page.route('**/api.scryfall.com/cards/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ object: 'list', total_cards: 3, has_more: false, data: printings }),
      })
    })

    await page.goto('#/trade')
    const rightColumn = page.locator('.trade-col[data-side="right"]')
    await rightColumn.locator('.search-mode-toggle').click()
    await rightColumn.locator('.search-input').fill('Mana')
    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(3)

    await modal.locator('.trade-picker-filter').fill('mkm')
    await expect(modal.locator('.trade-picker-item')).toHaveCount(1)
    await expect(modal.locator('.trade-picker-set').first()).toContainText('MKM')

    await modal.locator('.trade-picker-filter').fill('xx')
    await expect(modal.locator('.trade-picker-item')).toHaveCount(0)
    await expect(modal).toContainText('No printings match')
  })

  test('Copy Link encodes current trade state into the URL', async ({ page }) => {
    await page.goto('#/trade')

    // Add Lightning Bolt (qty 2 out of 3) from left collection
    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')
    const leftSuggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(leftSuggest).toBeVisible()
    await leftSuggest.locator('.search-suggest-row').first().click({ force: true })
    // Increment qty to 2
    const leftRow = page.locator('.trade-col[data-side="left"] .trade-row').first()
    await leftRow.locator('.qty-stepper button', { hasText: '+' }).click()

    // Add Mana Crypt from right wanted list
    const rightSearch = page.locator('.trade-col[data-side="right"] .search-input')
    await rightSearch.fill('Mana')
    const rightSuggest = page.locator('.trade-col[data-side="right"] .search-suggest')
    await expect(rightSuggest).toBeVisible()
    await rightSuggest.locator('.search-suggest-row').first().click({ force: true })

    await page.locator('.primary-toolbar button', { hasText: 'Copy Link' }).click()

    const hash = new URL(page.url()).hash
    const tradeParams = new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
    // Collection: cardIds 1 and 2 (first two Lightning Bolt IDs, qty=2)
    expect(tradeParams.get('leftSideColIds')).toContain('Trade%20Collection:1,2')
    // Wanted: cardId 1 + scryfall ID for Mana Crypt
    expect(tradeParams.get('rightSideWantedIds')).toContain(
      'Trade%20Wanted%20List:1@trade-crypt-id',
    )
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
  })

  test('navigating to a deck URL restores the deck card by numeric ID', async ({ page }) => {
    // Sol Ring in the deck has cardId 2 (mainboard) and 3 (sideboard), aggregated as one entry.
    // The URL uses numeric ID 2 to identify it.
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Trade Deck:2x1')
    await page.goto(`/#/trade?${params.toString()}`)

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Sol Ring',
    )
  })

  test('navigating to a deck URL restores a picker-selected card by numeric ID and scryfall override', async ({
    page,
  }) => {
    // Counterspell has cardId:1, no set/collectorNumber in the deck data.
    // The sfId selects the printing when restoring.
    const params = new URLSearchParams()
    params.set('leftSideDeckIds', 'Trade Deck:1x1@trade-counterspell-id')
    await page.goto(`/#/trade?${params.toString()}`)

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Counterspell',
    )
  })

  test('Copy Link then reload preserves the full trade state', async ({ page }) => {
    await page.goto('#/trade')

    // Add Sol Ring from left collection
    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Sol')
    const leftSuggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(leftSuggest).toBeVisible()
    await leftSuggest.locator('.search-suggest-row').first().click({ force: true })

    await page.locator('.primary-toolbar button', { hasText: 'Copy Link' }).click()

    const tradeUrl = page.url()
    expect(new URL(tradeUrl).hash).toContain('leftSideColIds=')

    // Navigate to the copied URL fresh
    await page.goto(tradeUrl)

    await expect(page.locator('.trade-col[data-side="left"] .trade-row-name-text')).toContainText(
      'Sol Ring',
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

    const leftSearch = page.locator('.trade-col[data-side="left"] .search-input')
    await leftSearch.fill('Lightning')
    const leftSuggest = page.locator('.trade-col[data-side="left"] .search-suggest')
    await expect(leftSuggest).toBeVisible()
    await leftSuggest.locator('.search-suggest-row').first().click({ force: true })

    const leftTotal = page.locator('.trade-col[data-side="left"] .trade-col-foot-total')
    await expect(leftTotal).toContainText('$2.50')

    // Override the collection endpoint to return an updated price for the bolt.
    let collectionRequests = 0
    let requestedIds: string[] = []
    await page.route('**/api.scryfall.com/cards/collection', async (route) => {
      collectionRequests++
      const body = route.request().postDataJSON() as { identifiers: { id: string }[] }
      requestedIds = body.identifiers.map((i) => i.id)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'trade-bolt-id',
              name: 'Lightning Bolt',
              cmc: 1,
              type_line: 'Instant',
              oracle_text: '',
              image_uris: {
                small: '',
                normal: '',
                large: '',
                png: '',
                art_crop: '',
                border_crop: '',
              },
              prices: {
                usd: '99.99',
                usd_foil: null,
                usd_etched: null,
                eur: null,
                eur_foil: null,
                tix: null,
              },
              finishes: ['nonfoil', 'foil'],
              games: ['paper'],
              set: 'lea',
              set_name: 'Limited Edition Alpha',
              collector_number: '161',
              rarity: 'common',
              color_identity: ['R'],
              released_at: '1993-08-05',
            },
          ],
          not_found: [],
        }),
      })
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
    await page.route('**/api.scryfall.com/cards/collection', async (route) => {
      collectionRequests++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], not_found: [] }),
      })
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
    await page.route('**/api.scryfall.com/cards/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: 'list',
          total_cards: 10,
          has_more: false,
          data: tenPrintings,
        }),
      })
    })

    await page.goto('#/trade')
    const rightColumn = page.locator('.trade-col[data-side="right"]')
    await rightColumn.locator('.search-mode-toggle').click()
    await rightColumn.locator('.search-input').fill('Mana')
    const suggest = rightColumn.locator('.search-suggest')
    await expect(suggest).toBeVisible({ timeout: 2000 })
    await suggest.locator('.search-suggest-row').first().click({ force: true })

    const modal = page.locator('.trade-picker-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(8)
    await expect(modal.locator('.trade-picker-pagination-info')).toContainText('Page 1 of 2')

    await modal.locator('button', { hasText: 'Next →' }).click()
    await expect(modal.locator('.trade-picker-item')).toHaveCount(2)
    await expect(modal.locator('.trade-picker-pagination-info')).toContainText('Page 2 of 2')
  })
})
