import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockPublicSiteDeckForFilters } from '../helpers/mock-data'
import { openFilterMenu } from '../helpers/filter-menu'

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

const groupSelect = (page: Page) =>
  page.locator('.toolbar-group', { hasText: 'Group:' }).locator('select')
const sortSelect = (page: Page) =>
  page.locator('.toolbar-group', { hasText: 'Sort:' }).locator('select')

test.describe('List view shareable URL', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckForFilters(page)
  })

  test('toolbar and filter changes that deviate from defaults are written to the URL', async ({
    page,
  }) => {
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // A pristine view leaves the query string empty.
    expect(page.url()).not.toContain('?')

    await page.locator('[data-view="list"]').click()
    await groupSelect(page).selectOption('cmc')
    await sortSelect(page).selectOption('price')

    await openFilterMenu(page)
    await page.locator('#filter-name').fill('green')
    await page.getByRole('button', { name: 'Hide Lands' }).click()

    await expect.poll(() => new URL(page.url()).hash.split('?')[1] ?? '').toContain('view=list')
    const query = new URLSearchParams(new URL(page.url()).hash.split('?')[1])
    expect(query.get('view')).toBe('list')
    expect(query.get('group')).toBe('cmc')
    expect(query.get('sort')).toBe('price')
    expect(query.get('name')).toBe('green')
    expect(query.get('noLands')).toBe('1')
  })

  test('returning a setting to its default removes its parameter from the URL', async ({
    page,
  }) => {
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    await groupSelect(page).selectOption('cmc')
    await expect.poll(() => page.url()).toContain('group=cmc')

    // Deck default group is 'type'; selecting it again clears the param.
    await groupSelect(page).selectOption('type')
    await expect.poll(() => new URL(page.url()).hash).not.toContain('group=')
  })

  test('deactivating a filter removes its parameter from the URL', async ({ page }) => {
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    await openFilterMenu(page)
    await page.getByRole('button', { name: 'Hide Lands' }).click()
    await expect.poll(() => page.url()).toContain('noLands=1')

    await page.getByRole('button', { name: 'Hide Lands' }).click()
    await expect.poll(() => new URL(page.url()).hash).not.toContain('noLands')
  })

  test('card size is captured in the URL and restored on load', async ({ page }) => {
    await page.goto('#/deck/test-filter-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // The size buttons (L/M/S) sit in the second .view-toggle group; pick Small.
    const smallButton = page.locator('.view-toggle').nth(1).getByRole('button', { name: 'S' })
    await smallButton.click()
    await expect.poll(() => page.url()).toContain('size=small')

    // Reloading the size=small URL re-reads it on a fresh page load.
    await page.reload()
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await expect(
      page.locator('.view-toggle').nth(1).getByRole('button', { name: 'S' }),
    ).toHaveClass(/active/)
  })

  test('a shared URL restores group, sort, view, and filters on load', async ({ page }) => {
    await page.goto('#/deck/test-filter-deck?view=list&group=cmc&sort=price&noLands=1')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    await expect(page.locator('[data-view="list"]')).toHaveClass(/active/)
    await expect(groupSelect(page)).toHaveValue('cmc')
    await expect(sortSelect(page)).toHaveValue('price')

    // Hide Lands was active in the link: 'Test Forest' (the only land) is gone.
    await expectVisibleCards(
      page,
      ALL_CARDS.filter((c) => c !== 'Test Forest'),
    )

    await openFilterMenu(page)
    await expect(page.getByRole('button', { name: 'Hide Lands' })).toHaveClass(/active/)
    await expect(page.locator('.filter-menu-badge')).toHaveText('1')
  })

  test('malformed parameters are ignored and fall back to defaults', async ({ page }) => {
    await page.goto('#/deck/test-filter-deck?group=banana&sort=chaos&view=teleport')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // Defaults survive: binder view, group 'type', sort 'name'.
    await expect(page.locator('[data-view="binder"]')).toHaveClass(/active/)
    await expect(groupSelect(page)).toHaveValue('type')
    await expect(sortSelect(page)).toHaveValue('name')
  })
})
