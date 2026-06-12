import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockPublicSiteDeckForFilters } from '../helpers/mock-data'
import { openFilterMenu } from '../helpers/filter-menu'

// 'Maybe Dragon' lives in the Maybeboard (extras) section; the rest are mainboard.
const ALL_CARDS = [
  'Boring Rock',
  'Golgari Lord',
  'Green Elf',
  'Maybe Dragon',
  'Test Forest',
  'White Knight',
]

/** Assert the visible card names (order-independent), retrying while the DOM updates. */
async function expectVisibleCards(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(async () => (await page.locator('.list-name').allTextContents()).sort())
    .toEqual([...names].sort())
}

test.describe('Toolbar Filters menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
  })

  test('clicking the Filters button while open closes the menu', async ({ page }) => {
    await openFilterMenu(page)
    await expect(page.locator('.filter-menu-panel')).toBeVisible()

    await page.locator('.filter-menu > button').click()
    await expect(page.locator('.filter-menu-panel')).not.toBeVisible()
  })

  test('name filter matches space-separated terms in any order', async ({ page }) => {
    await expectVisibleCards(page, ALL_CARDS)

    await openFilterMenu(page)
    await page.locator('#filter-name').fill('elf green')
    await expectVisibleCards(page, ['Green Elf'])

    await page.locator('#filter-name').fill('')
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('color identity filter is exclusive by default and subset-matches when inclusive', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('.filter-color-btn[title="Black"]').click()
    await page.locator('.filter-color-btn[title="Green"]').click()

    // Exclusive: only the card whose identity is exactly {B, G}
    await expectVisibleCards(page, ['Golgari Lord'])

    // Inclusive: everything playable in a B/G deck (subsets of {B, G}, including colorless)
    await page.getByRole('button', { name: 'Inclusive' }).click()
    await expectVisibleCards(page, ['Boring Rock', 'Golgari Lord', 'Green Elf', 'Test Forest'])
  })

  test('typing a set code followed by a space creates a tag that filters by set', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-sets').fill('tsb ')

    await expect(page.locator('.filter-tag')).toHaveText(/TSB/)
    await expectVisibleCards(page, ['Boring Rock', 'Green Elf'])

    await page.getByRole('button', { name: 'Remove TSB' }).click()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('set code autocomplete suggests codes from the list and adds a tag on click', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-sets').click()

    const suggestions = page.locator('.filter-tags-suggestions button')
    await expect(suggestions).toHaveText(['TSA', 'TSB'])

    await suggestions.filter({ hasText: 'TSA' }).click()
    await expect(page.locator('.filter-tag')).toHaveText(/TSA/)
    await expectVisibleCards(page, ['Golgari Lord', 'Maybe Dragon', 'Test Forest', 'White Knight'])
  })

  test('mana value filter matches the exact value, including 0', async ({ page }) => {
    await openFilterMenu(page)
    await page.locator('#filter-mana-value').fill('0')
    await expectVisibleCards(page, ['Test Forest'])

    await page.locator('#filter-mana-value').fill('2')
    await expectVisibleCards(page, ['Boring Rock', 'White Knight'])

    await page.locator('#filter-mana-value').fill('')
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('mana value comparator supports less-than and greater-than-or-equal matching', async ({
    page,
  }) => {
    await openFilterMenu(page)
    const comparator = page.getByLabel('Mana value comparison')
    await page.locator('#filter-mana-value').fill('2')

    await comparator.selectOption('>=')
    await expectVisibleCards(page, ['Boring Rock', 'Golgari Lord', 'Maybe Dragon', 'White Knight'])

    await comparator.selectOption('<')
    await expectVisibleCards(page, ['Green Elf', 'Test Forest'])

    await comparator.selectOption('<=')
    await expectVisibleCards(page, ['Boring Rock', 'Green Elf', 'Test Forest', 'White Knight'])
  })

  test('Hide Lands and Hide Unpriced toggles live in the menu and combine', async ({ page }) => {
    await openFilterMenu(page)

    await page.getByRole('button', { name: 'Hide Lands' }).click()
    await expectVisibleCards(page, [
      'Boring Rock',
      'Golgari Lord',
      'Green Elf',
      'Maybe Dragon',
      'White Knight',
    ])

    await page.getByRole('button', { name: 'Hide Unpriced' }).click()
    await expectVisibleCards(page, ['Golgari Lord', 'Green Elf', 'Maybe Dragon', 'White Knight'])
  })

  test('Hide Extras toggle hides the maybeboard section', async ({ page }) => {
    await openFilterMenu(page)

    await page.getByRole('button', { name: 'Hide Extras' }).click()
    await expectVisibleCards(page, [
      'Boring Rock',
      'Golgari Lord',
      'Green Elf',
      'Test Forest',
      'White Knight',
    ])

    await page.getByRole('button', { name: 'Hide Extras' }).click()
    await expectVisibleCards(page, ALL_CARDS)
  })

  test('Filters button shows an active-count badge and Clear all resets everything', async ({
    page,
  }) => {
    await openFilterMenu(page)
    await page.locator('#filter-name').fill('green')
    await page.locator('.filter-color-btn[title="Green"]').click()

    await expect(page.locator('.filter-menu-badge')).toHaveText('2')
    await expectVisibleCards(page, ['Green Elf'])

    await page.getByRole('button', { name: 'Clear all filters' }).click()
    await expect(page.locator('.filter-menu-badge')).not.toBeVisible()
    await expectVisibleCards(page, ALL_CARDS)
  })
})
