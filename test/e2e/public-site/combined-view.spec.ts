import { test, expect } from '@playwright/test'
import { mockPublicSiteCombinedLists } from '../helpers/mock-data'

/**
 * The combined list view: from a single list, "Combine with list" opens a modal of
 * the other lists; picking some and pressing View opens a synthetic "Combined List"
 * that merges their cards under lowest-common-denominator rules (no card merging,
 * sections preserved, source-list grouping). Also covers the "All" switch and that
 * multi-select still works across the combined tiles.
 */
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
    await page.evaluate(() => {
      window.location.hash = '#/combined?lists=deck:cv-deck,collection:cv-box'
    })
    await page.waitForSelector('.card-item', { timeout: 15_000 })

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
    await page.evaluate(() => {
      window.location.hash = '#/combined?lists=deck:cv-deck,collection:cv-box'
    })
    await page.waitForSelector('.card-item', { timeout: 15_000 })

    await page
      .locator('.card-item')
      .first()
      .locator('.card-binder')
      .click({ modifiers: ['ControlOrMeta'] })

    await expect(page.locator('.toolbar .selection-menu-btn')).toHaveText(/Selected \(1\)/)
    await expect(page.locator('.selection-menu-btn--navbar')).toHaveText(/All Selected \(1\)/)
  })
})
