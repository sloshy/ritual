import { test, expect } from '@playwright/test'
import type { ScryfallCard } from '../../../src/types'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { mockPublicSiteDeckWithMultipleSections } from '../helpers/mock-public-site'

/** A Scryfall card shape sufficient for the deck page's price + display reads. */
function scryfallCard(
  id: string,
  name: string,
  usd: string,
  collectorNumber: string,
): ScryfallCard {
  return makeMockScryfallCard({
    id,
    name,
    cmc: 2,
    type_line: 'Creature',
    mana_cost: '{1}',
    prices: { usd },
    collector_number: collectorNumber,
    edhrec_rank: 1000,
  })
}

test.describe('Public price refresh', () => {
  // The first refresh omits Test Artifact (leaving it at the build price); a second
  // refresh returns every card, so the staleness disclaimer should clear.
  let includeArtifact = false

  test.beforeEach(async ({ page }) => {
    includeArtifact = false
    await mockPublicSiteDeckWithMultipleSections(page)

    await fulfillJson(page, '**/cards/collection', () => {
      const data = [
        scryfallCard('creature-id', 'Test Creature', '10.00', '1'),
        scryfallCard('creature-b-id', 'Alpha Creature', '0.75', '4'),
        scryfallCard('instant-id', 'Test Instant', '0.50', '2'),
      ]
      const notFound: { id: string }[] = []
      if (includeArtifact) data.push(scryfallCard('artifact-id', 'Test Artifact', '2.00', '3'))
      else notFound.push({ id: 'artifact-id' })
      return { data, not_found: notFound }
    })

    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('updates prices in place and discloses cards left at the older price', async ({ page }) => {
    // Baked total: 1.00 + 0.75 + 0.50 + 2.00 = $4.25. No disclaimer yet.
    await expect(page.locator('.page-stats')).toContainText('4.25')
    await expect(page.locator('.price-staleness')).toHaveCount(0)

    // Refresh prices from "Scryfall".
    await page.locator('.btn-update-prices').click()

    // Test Creature jumped to $10.00 → new total 10 + 0.75 + 0.50 + 2.00 = $13.25.
    await expect(page.locator('.page-stats')).toContainText('13.25')

    // Test Artifact was not refreshed → flagged as outdated; expand to confirm.
    const notice = page.locator('.price-staleness')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('1 card has an older price')
    await notice.locator('.price-staleness-toggle').click()
    await expect(notice.locator('.price-staleness-list')).toContainText('Test Artifact')
  })

  test('clears the disclaimer once every card is refreshed', async ({ page }) => {
    await page.locator('.btn-update-prices').click()
    await expect(page.locator('.price-staleness')).toBeVisible()

    // Next refresh covers Test Artifact too → no card is left behind.
    includeArtifact = true
    await page.locator('.btn-update-prices').click()
    await expect(page.locator('.price-staleness')).toHaveCount(0)
  })
})
