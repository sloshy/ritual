import { test, expect } from '@playwright/test'
import { mockPublicSiteForFind } from '../helpers/mock-public-site'

/**
 * The Find page: paste a list of card names, search every list by name, and see
 * which appear where as a list view grouped by source list. Covers front-face-only
 * matching for double-faced cards, double-art printings sharing one name, the
 * not-found warning + textarea rewrite, accumulating with "Add Cards to Search",
 * the page-local multi-selection (which never enters the global pool), the per-list
 * select-all toggle, "Add Selected to Trade", and "View Selected as List".
 */
test.describe('Find page', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForFind(page)
    await page.goto('#/find')
    await page.waitForSelector('.find-input', { timeout: 15_000 })
  })

  test('searches names across lists, as a list view grouped by source, front-face only', async ({
    page,
  }) => {
    // Smoke: the Find link appears in the header nav and is marked active on #/find.
    const findLink = page.getByRole('link', { name: 'Find', exact: true })
    await expect(findLink).toBeVisible()
    await expect(findLink).toHaveClass(/site-nav-link-active/)

    await page
      .locator('.find-input')
      .fill('Lightning Bolt\nSol Ring\nBruce Banner\nSteam Vents\nBlack Lotus')
    await page.getByRole('button', { name: 'Search', exact: true }).click()

    await page.waitForSelector('.find-results .card-item', { timeout: 15_000 })

    // Two source lists contributed matches: the deck and the collection.
    await expect(page.locator('.find-results [data-section]')).toHaveCount(2)

    const deckGroup = page.locator('[data-section="Find Deck"]')
    const boxGroup = page.locator('[data-section="Find Box"]')
    // Deck: Bolt, the double-faced Bruce Banner (matched on its front face), Steam Vents.
    await expect(deckGroup.locator('.card-item')).toHaveCount(3)
    await expect(deckGroup).toContainText('Lightning Bolt')
    await expect(deckGroup).toContainText('Bruce Banner')
    await expect(deckGroup).toContainText('Steam Vents')
    // Collection: Sol Ring + the double-art "Steam Vents // Steam Vents" printing.
    await expect(boxGroup.locator('.card-item')).toHaveCount(2)
    await expect(boxGroup).toContainText('Sol Ring')
    await expect(boxGroup).toContainText('Steam Vents')

    // Summary line counts copies (5) across the two source lists.
    await expect(page.locator('.find-summary')).toContainText('Found 5 cards across 2 lists')

    // The source-list headings link back to each list.
    await expect(deckGroup.locator('a.combined-source-name')).toHaveAttribute(
      'href',
      '#/deck/find-deck',
    )

    // Black Lotus matched nothing: warning shown and only it remains in the box.
    await expect(page.locator('.find-warning')).toContainText('1 card could not be found')
    await expect(page.locator('.find-input')).toHaveValue('Black Lotus')

    // Clicking a card row opens the detail modal (and closes via its button).
    await deckGroup.locator('.card-item .card-list').first().click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal-close').click()
    await expect(page.locator('.card-modal')).not.toBeVisible({ timeout: 3000 })
  })

  test('a double-faced back-side name does not match', async ({ page }) => {
    await page.locator('.find-input').fill('The Incredible Hulk')
    await page.getByRole('button', { name: 'Search', exact: true }).click()

    await expect(page.locator('.find-warning')).toContainText('1 card could not be found')
    await expect(page.locator('.find-results [data-section]')).toHaveCount(0)
    await expect(page.locator('.find-empty')).toBeVisible()
    await expect(page.locator('.find-input')).toHaveValue('The Incredible Hulk')
  })

  test('"Add Cards to Search" merges new finds into the existing results', async ({ page }) => {
    await page.locator('.find-input').fill('Lightning Bolt')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.waitForSelector('.find-results .card-item')
    await expect(page.locator('.find-results [data-section]')).toHaveCount(1)

    // Add a wanted-list card; the deck result from the first search is preserved.
    await page.locator('.find-input').fill('Counterspell')
    await page.getByRole('button', { name: 'Add Cards to Search' }).click()

    await expect(page.locator('.find-results [data-section]')).toHaveCount(2)
    // The first search's deck result survives the merge (not replaced).
    await expect(page.locator('[data-section="Find Deck"] .card-item')).toHaveCount(1)
    await expect(page.locator('[data-section="Find Deck"]')).toContainText('Lightning Bolt')
    await expect(page.locator('[data-section="Find Wanted"]')).toContainText('Counterspell')
    // Everything was found this round, so the warning clears and the box empties.
    await expect(page.locator('.find-warning')).toHaveCount(0)
    await expect(page.locator('.find-input')).toHaveValue('')
  })

  test('selecting cards stays page-local and "View Selected as List" shows just them', async ({
    page,
  }) => {
    await page.locator('.find-input').fill('Lightning Bolt\nSol Ring\nSteam Vents')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.waitForSelector('.find-results .card-item')

    // The action bar is always present; with nothing selected its buttons are disabled.
    await expect(page.locator('.find-selection-bar')).toBeVisible()
    await expect(page.locator('.find-selection-count')).toHaveText('0 cards selected')
    await expect(page.getByRole('button', { name: 'View Selected as List' })).toBeDisabled()

    // "Select All" grabs every matched card (4 — Steam Vents matches in both lists),
    // then disables itself; Clear resets.
    await page.getByRole('button', { name: 'Select All', exact: true }).click()
    await expect(page.locator('.find-selection-count')).toHaveText('4 cards selected')
    await expect(page.getByRole('button', { name: 'Select All', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Clear Selection' }).click()
    await expect(page.locator('.find-selection-count')).toHaveText('0 cards selected')

    // The per-list toggle selects every card in the collection group (Sol Ring + Steam Vents).
    await page.locator('[data-section="Find Box"] .section-divider .card-select-checkbox').click()
    await expect(page.locator('.find-selection-count')).toHaveText('2 cards selected')
    await expect(page.getByRole('button', { name: 'View Selected as List' })).toBeEnabled()

    // Plus one individual card from the deck group.
    await page
      .locator('[data-section="Find Deck"] .binder-grid .card-select-checkbox')
      .first()
      .click()
    await expect(page.locator('.find-selection-count')).toHaveText('3 cards selected')
    // The toggled rows reflect their selected state in the DOM (reactive per-row).
    await expect(page.locator('.find-results .card-item.is-selected')).toHaveCount(3)

    // Page-local selection must NOT feed the global cross-list selection pool.
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveCount(0)

    await page.getByRole('button', { name: 'View Selected as List' }).click()
    await expect(page).toHaveURL(/#\/search-results$/)
    await expect(page.locator('.page-title')).toHaveText('Search Results')
    await expect(page.locator('.card-item')).toHaveCount(3)
  })

  test('"Add Selected to Trade" adds the selected cards to the active trade', async ({ page }) => {
    await page.locator('.find-input').fill('Lightning Bolt\nSol Ring')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.waitForSelector('.find-results .card-item')

    // Select both printing-pinned cards (no printing picker needed) and add to trade.
    await page.locator('[data-section="Find Deck"] .section-divider .card-select-checkbox').click()
    await page.locator('[data-section="Find Box"] .section-divider .card-select-checkbox').click()
    await expect(page.locator('.find-selection-count')).toHaveText('2 cards selected')

    await page.getByRole('button', { name: 'Add Selected to Trade' }).click()
    // The selection clears once added (bar stays, count resets to zero).
    await expect(page.locator('.find-selection-count')).toHaveText('0 cards selected')

    // Both cards came from collection/deck sources, so they land on the trade's left side.
    await page.goto('#/trade')
    const left = page.locator('.trade-col[data-side="left"] .trade-row-name-text')
    await expect(left).toContainText(['Lightning Bolt'])
    await expect(left).toContainText(['Sol Ring'])
  })
})
