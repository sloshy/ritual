import { test, expect, type Page } from '@playwright/test'
import {
  MOCK_SITE_DEFAULT_CATEGORY,
  mockPublicSiteCollectionWithCategories,
  mockPublicSiteCollectionWithDuplicateNames,
  mockPublicSiteDeckWithCategories,
} from '../helpers/mock-public-site'
import {
  enterEditMode,
  gotoList,
  openEditCategories,
  removeCardTile,
  switchToListView,
} from '../helpers/list-ui'
import { openFilterMenu } from '../helpers/filter-menu'

/**
 * Card categories on the public site: the two groupings (primary only, and every
 * category with the non-primary appearances dimmed and badged), the category
 * sort, the categories filter row and its shared link, and the public editor's
 * "Edit Categories…" flow. The ordering and matching rules themselves are pinned
 * at the unit layer; these cover the state transitions.
 */

const tile = (page: Page, name: string) => page.locator(`.card-item[data-name="${name}"]`)

test.describe('Card categories', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithCategories(page)
    await gotoList(page, '#/collection/category-binder')
  })

  test("group by category: the list's own order, Uncategorized last", async ({ page }) => {
    await page.locator('.toolbar select').first().selectOption('category')
    await expect(page).toHaveURL(/group=category/)

    // The sidecar's order is Ramp, Draw, Artifacts — not the alphabet — and
    // Artifacts draws no heading here because no card's *primary* is Artifacts.
    await expect(page.locator('.section-divider h2')).toHaveText(['Ramp', 'Draw', 'Uncategorized'])
    // A two-category card sits under its primary only.
    await expect(page.locator('[data-section="Ramp"] .card-item')).toHaveCount(2)
    await expect(page.locator('[data-section="Uncategorized"] .card-item')).toHaveCount(1)
  })

  test('group by categories: the two-category card appears twice, dimmed under the second', async ({
    page,
  }) => {
    await page.locator('.toolbar select').first().selectOption('categories')
    await expect(page).toHaveURL(/group=categories/)

    await expect(page.locator('.section-divider h2')).toHaveText([
      'Ramp',
      'Draw',
      'Artifacts',
      'Uncategorized',
    ])
    await expect(page.locator('[data-section="Artifacts"] .card-item')).toHaveCount(1)

    // Only the non-primary appearance is dimmed and badged.
    const artifacts = page.locator('[data-section="Artifacts"]')
    await expect(artifacts.locator('.card-slot--secondary')).toHaveCount(1)
    await expect(artifacts.locator('.card-secondary-marker')).toHaveAttribute('title', /Ramp/)
    await expect(artifacts.locator('.section-note')).toBeVisible()

    const ramp = page.locator('[data-section="Ramp"]')
    await expect(ramp.locator('.card-slot--secondary')).toHaveCount(0)
    await expect(ramp.locator('.card-secondary-marker')).toHaveCount(0)
  })

  test('sort by category orders by primary, uncategorized last', async ({ page }) => {
    await switchToListView(page)
    await page.locator('.toolbar-sort-layer select').first().selectOption('category')
    await expect(page).toHaveURL(/sort=category/)

    // Draw < Ramp by display collation; the uncategorized card is last.
    await expect(page.locator('.list-name')).toHaveText([
      'Draw Spell',
      'Ramp Rock',
      'Signet Rock',
      'Plain Card',
    ])
  })

  test('the categories filter narrows the list and keeps the name spelled as the list does', async ({
    page,
  }) => {
    await switchToListView(page)
    await openFilterMenu(page)
    const field = page.locator('#filter-categories')
    await expect(field).toBeVisible()

    await field.fill('Ramp,')
    // The committed chip keeps the list's own capitalization.
    const row = page.locator('.filter-row', { has: page.locator('#filter-categories') })
    await expect(row.locator('.filter-tag')).toHaveText([/Ramp/])
    await expect(page).toHaveURL(/cats=Ramp/)
    await expect(page.locator('.list-name')).toHaveText(['Ramp Rock', 'Signet Rock'])

    // Exclude inverts the selection.
    await row.getByRole('button', { name: 'Exclude' }).click()
    await expect(page.locator('.list-name')).toHaveText(['Draw Spell', 'Plain Card'])
    await expect(page).toHaveURL(/catMode=exclude/)
  })

  test('the card modal lists the categories as chips, the primary one marked', async ({ page }) => {
    await tile(page, 'signet rock').click()
    const modal = page.locator('.card-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.modal-card-category')).toHaveText(['Ramp', 'Artifacts'])
    await expect(modal.locator('.modal-card-category--primary')).toHaveText(['Ramp'])
  })
})

/**
 * Design §1.1 as this phase implements it: a deck partitions its boards before
 * grouping, so the **mainboard** is what gets grouped by category while the
 * sideboard and extras stay in their own ungrouped sections below.
 */
test.describe('Card categories — decks group the mainboard only', () => {
  test('the sideboard keeps its own section and never appears under a category', async ({
    page,
  }) => {
    await mockPublicSiteDeckWithCategories(page)
    await gotoList(page, '#/deck/category-deck')
    await page.locator('.toolbar select').first().selectOption('category')

    // Mainboard headings are categories; the sideboard is still its own section.
    const headings = page.locator('.section-divider h2')
    await expect(headings).toHaveText(['Ramp', 'Uncategorized', 'Sideboard'])
    await expect(page.locator('[data-section="Ramp"] .card-item')).toHaveCount(1)
    // The sideboard's categorized card draws no `Draw` heading of its own.
    await expect(page.locator('[data-section="Draw"]')).toHaveCount(0)
    await expect(page.locator('[data-section="Sideboard"] .card-item')).toHaveCount(1)
  })
})

/**
 * The caller half of the name-keyed fold: a pending `set-categories` survives
 * while another line of that name remains, and leaves with the last one.
 */
test.describe('Public editor — categories of a name with two lines', () => {
  test('the pending change survives the first removal and folds with the last', async ({
    page,
  }) => {
    await mockPublicSiteCollectionWithDuplicateNames(page)
    await enterEditMode(page, '#/collection/duplicate-binder')

    const dialog = await openEditCategories(page, tile(page, 'ramp rock').first())
    await dialog.locator('#categories-prompt-input').fill('Ramp, Artifacts')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // One line of the name gone, the other still there: the assignment stands.
    await removeCardTile(tile(page, 'ramp rock').first())
    await expect(page.locator('.changes-badge')).toHaveText('2')
    await page.locator('.btn-changes').click()
    const categoryChange = page.locator('.changes-modal .change-item', {
      hasText: 'Set categories',
    })
    await expect(categoryChange).toHaveCount(1)
    await page.keyboard.press('Escape')

    // The last line of the name goes: the `set-categories` folds out with it.
    await removeCardTile(tile(page, 'ramp rock').first())
    await page.locator('.btn-changes').click()
    await expect(categoryChange).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Undo puts the line — and the categories it carried — back.
    await page.locator('.btn-undo').click()
    await page.locator('.btn-changes').click()
    await expect(categoryChange).toHaveCount(1)
  })
})

/**
 * Opened cold, in its own describe: the app's toolbar state is module-level and
 * survives an in-SPA navigation, so a link's parameters are only read on the
 * first navigation of a test.
 */
test.describe('Card categories — shared link', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithCategories(page)
  })

  test('a shared link restores the grouping and the chip, still spelled Ramp', async ({ page }) => {
    // A shared link is opened cold, exactly as the other URL-state specs do.
    await gotoList(page, '#/collection/category-binder?group=categories&cats=Ramp')
    await expect(page.locator('.section-divider h2').first()).toHaveText('Ramp')
    await expect(page.locator('.toolbar select').first()).toHaveValue('categories')

    await openFilterMenu(page)
    const row = page.locator('.filter-row', { has: page.locator('#filter-categories') })
    await expect(row.locator('.filter-tag')).toHaveText([/Ramp/])
  })
})

test.describe('Public editor — Edit Categories…', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteCollectionWithCategories(page)
    await enterEditMode(page, '#/collection/category-binder')
  })

  test('the dialog seeds, reorders the primary, and records one pending change', async ({
    page,
  }) => {
    let dialog = await openEditCategories(page, tile(page, 'signet rock'))
    const input = dialog.locator('#categories-prompt-input')
    await expect(input).toHaveValue('Ramp, Artifacts')

    // The chip row shows the parsed order, the first marked primary.
    await expect(dialog.locator('.categories-prompt-chip')).toHaveText([/Ramp/, /Artifacts/])
    await expect(dialog.locator('.categories-prompt-chip').first()).toHaveClass(
      /categories-prompt-chip--primary/,
    )

    // ▶ on the first chip makes Artifacts primary and rewrites the field.
    await dialog
      .locator('.categories-prompt-chip')
      .first()
      .getByRole('button', { name: 'Move later' })
      .click()
    await expect(input).toHaveValue('Artifacts, Ramp')
    await expect(dialog.locator('.categories-prompt-chip').first()).toContainText('Artifacts')

    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).not.toBeVisible()

    await expect(page.locator('.changes-badge')).toHaveText('1')
    await page.locator('.btn-changes').click()
    await expect(page.locator('.changes-modal .change-item')).toContainText(
      'Set categories of Signet Rock to Artifacts, Ramp',
    )
    await page.keyboard.press('Escape')

    // Restoring the on-disk value cancels the pending change outright.
    dialog = await openEditCategories(page, tile(page, 'signet rock'))
    await dialog.locator('#categories-prompt-input').fill('Ramp, Artifacts')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test("suggestions offer the list's vocabulary and the site's configured defaults", async ({
    page,
  }) => {
    const dialog = await openEditCategories(page, tile(page, 'plain card'))
    await expect(dialog.locator('#categories-prompt-input')).toHaveValue('')
    await expect(dialog.locator('.categories-prompt-suggestion')).toHaveText([
      'Ramp',
      'Draw',
      'Artifacts',
      MOCK_SITE_DEFAULT_CATEGORY,
    ])
  })

  test('an invalid category is explained and blocks Save', async ({ page }) => {
    const dialog = await openEditCategories(page, tile(page, 'ramp rock'))
    await dialog.locator('#categories-prompt-input').fill('Ramp, #bad')
    await expect(dialog.locator('.form-error')).toContainText('Invalid category')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
