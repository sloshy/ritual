import { test, expect, type Page } from '@playwright/test'
import { mockPublicSiteCombinedLists } from '../helpers/mock-public-site'

/**
 * The combined list view: from a single list, "Combine with list" opens a modal of
 * the other lists; picking some and pressing View opens a synthetic "Combined List"
 * that merges their cards under lowest-common-denominator rules (no card merging,
 * sections preserved, source-list grouping). Also covers the "All" switch, that
 * multi-select still works across the combined tiles, and the per-tile "Add to
 * Trade" hand-off to the trade board.
 */

/**
 * Navigate within the SPA by assigning the hash rather than `page.goto`, which
 * would reload the bundle and drop the module-level trade/selection signals this
 * file's tests depend on. Local to this spec for that reason — `helpers/list-ui.ts`
 * navigates with `page.goto`.
 */
async function gotoCombined(page: Page, query = 'lists=deck:cv-deck,collection:cv-box') {
  await page.evaluate((q) => {
    window.location.hash = `#/combined?${q}`
  }, query)
  await page.waitForSelector('.card-item', { timeout: 15_000 })
}
test.describe('Combined list view', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCombinedLists(page)
    await page.goto('#/deck/cv-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('combines a deck and a collection, keeping cards unmerged and grouped by source', async ({
    page,
  }) => {
    // The combine button is present on the single-list view.
    const combineBtn = page.getByRole('button', { name: /Combine with list/ })
    await expect(combineBtn).toBeVisible()
    await combineBtn.click()

    // The modal lists the *other* list (the collection), not the deck we're on.
    const modal = page.locator('.combine-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.combine-modal-subtitle')).toContainText('CV Deck')
    const rows = modal.locator('.combine-modal-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('CV Box')
    await expect(rows.first()).toContainText('Collections')
    await expect(rows.first()).toContainText('1 card')

    // Pick the collection and view the combination.
    await rows.first().locator('input[type="checkbox"]').check()
    await modal.getByRole('button', { name: 'View' }).click()

    // URL encodes the current list first, then the picked one.
    await expect(page).toHaveURL(/#\/combined\?lists=deck:cv-deck,collection:cv-box/)

    // Header: synthetic title, combined copy count (1 + 2 + 1 = 4), and the source list.
    await expect(page.locator('.page-title')).toHaveText('Combined List')
    await expect(page.locator('.page-stats')).toContainText('4 cards')
    await expect(page.locator('.combined-sources')).toContainText('CV Deck')
    await expect(page.locator('.combined-sources')).toContainText('CV Box')

    // Lowest-common-denominator: the two Sol Ring copies are NOT merged across lists,
    // so there are three tiles total (Bolt, deck Sol Ring ×2, collection Sol Ring).
    await expect(page.locator('.card-item')).toHaveCount(3)

    // Default grouping is by source list: one section per combined list.
    const sectionLabels = page.locator('.card-sections .section-divider h2')
    await expect(sectionLabels).toHaveCount(2)
    await expect(sectionLabels.nth(0)).toHaveText('CV Deck')
    await expect(sectionLabels.nth(1)).toHaveText('CV Box')
  })

  test('the combine modal closes on Escape', async ({ page }) => {
    await page.getByRole('button', { name: /Combine with list/ }).click()
    const modal = page.locator('.combine-modal')
    await expect(modal).toBeVisible()

    await page.keyboard.press('Escape')
    // The modal is a native <dialog> that stays mounted; closing hides it.
    await expect(modal).not.toBeVisible()
  })

  test('the All switch views every list and labels it accordingly', async ({ page }) => {
    await page.getByRole('button', { name: /Combine with list/ }).click()
    const modal = page.locator('.combine-modal')
    await modal.locator('.combine-modal-all input[type="checkbox"]').check()
    // With All on, the per-list checkboxes are disabled.
    await expect(modal.locator('.combine-modal-row input[type="checkbox"]').first()).toBeDisabled()
    await modal.getByRole('button', { name: 'View' }).click()

    await expect(page).toHaveURL(/#\/combined\?all$/)
    await expect(page.locator('.page-title')).toHaveText('All Cards')
    await expect(page.locator('.combined-sources')).toHaveText('Viewing all cards from all lists')
    // Deck (3 copies across 2 tiles) + collection (1) = 4 copies, 3 tiles.
    await expect(page.locator('.page-stats')).toContainText('4 cards')
    await expect(page.locator('.card-item')).toHaveCount(3)
  })

  test('the navbar "All" button views every list and stays highlighted', async ({ page }) => {
    const allLink = page.getByRole('link', { name: 'All', exact: true })
    await expect(allLink).toHaveClass(/site-nav-link-inactive/)
    await allLink.click()

    await expect(page).toHaveURL(/#\/combined\?all$/)
    await expect(page.locator('.combined-sources')).toHaveText('Viewing all cards from all lists')
    // On the all-lists view, the "All" link is lit and the others are not.
    await expect(allLink).toHaveClass(/site-nav-link-active/)
    await expect(page.getByRole('link', { name: 'Decks', exact: true })).toHaveClass(
      /site-nav-link-inactive/,
    )
  })

  test('the source-list names link back to each individual list', async ({ page }) => {
    await gotoCombined(page)

    const sources = page.locator('.combined-source-name')
    await expect(sources).toHaveCount(2)
    await expect(sources.nth(0)).toHaveAttribute('href', '#/deck/cv-deck')
    await expect(sources.nth(1)).toHaveAttribute('href', '#/collection/cv-box')

    // Clicking a source name navigates to that list.
    await sources.nth(1).click()
    await expect(page).toHaveURL(/#\/collection\/cv-box$/)
    await expect(page.locator('.page-title')).toHaveText('CV Box')
  })

  test('the index "View all decks" button opens the all-decks combined view', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    const viewAll = page.getByRole('link', { name: 'View all decks' })
    await expect(viewAll).toBeVisible()
    await viewAll.click()

    await expect(page).toHaveURL(/#\/combined\?all=deck$/)
    await expect(page.locator('.page-title')).toHaveText('All Decks')
    await expect(page.locator('.combined-sources')).toHaveText('Viewing all decks')
    // Only the deck's cards appear (the CV Box collection is excluded): Bolt + Sol
    // Ring ×2 = 2 tiles, 3 copies. The "Decks" navbar link stays lit for this view.
    await expect(page.locator('.page-stats')).toContainText('3 cards')
    await expect(page.locator('.card-item')).toHaveCount(2)
    await expect(page.locator('.card-sections')).not.toContainText('CV Box')
    await expect(page.getByRole('link', { name: 'Decks', exact: true })).toHaveClass(
      /site-nav-link-active/,
    )
  })

  test('cards in the combined view are multi-selectable', async ({ page }) => {
    await gotoCombined(page)

    await page
      .locator('.card-item')
      .first()
      .locator('.card-binder')
      .click({ modifiers: ['ControlOrMeta'] })

    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveText(/Selected \(1\)/)
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveText(/All Selected \(1\)/)
  })

  test('the per-tile "+" adds a combined-view card to the trade', async ({ page }) => {
    await gotoCombined(page)

    // Grouped by source: the CV Box section is last and holds the collection's
    // single Sol Ring. The deck holds the *same* printing, so every later
    // assertion names the source rather than the card.
    const ring = page.locator('.card-item').last()
    await expect(ring).toContainText('Sol Ring')
    // The corner bookmark only takes pointer events while the tile is hovered.
    await ring.locator('.card-binder').hover()
    await ring.locator('.card-trade-btn').click()

    // The single-card add toasts the card's name, not a copy count.
    await expect(page.locator('.trade-add-toast')).toContainText('Sol Ring')
    // The "+" disables once the collection's single copy is committed...
    await expect(ring.locator('.card-trade-btn')).toBeDisabled()
    // ...while the deck's two copies of the same card stay addable.
    const deckRing = page.locator('.card-item').nth(1)
    await expect(deckRing).toContainText('Sol Ring')
    await expect(deckRing.locator('.card-trade-btn')).toBeEnabled()

    // Adding from a tile neither requires nor creates a selection, and does not
    // open the card modal behind the button.
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
    await expect(page.locator('.card-modal')).toBeHidden()

    await page.evaluate(() => {
      window.location.hash = '#/trade'
    })
    const row = page.locator('.trade-col[data-side="left"] .trade-row')
    await expect(row).toHaveCount(1)
    await expect(row.locator('.trade-row-name-text')).toContainText('Sol Ring')
    // The collection's copy, not the deck's — and the printing renders uppercase.
    await expect(row.locator('.src-tag').first()).toHaveText('Collection')
    await expect(row.locator('.trade-row-name-meta')).toContainText('C19:221')
  })
})
