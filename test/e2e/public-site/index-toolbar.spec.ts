import { test, expect } from '@playwright/test'
import { mockPublicSiteIndexLists } from '../helpers/mock-public-site'

const NAME = '.deck-cover .cover-info h2'
const REVERSE = '.toolbar button.toolbar-toggle'

test.describe('Deck index toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteIndexLists(page)
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('My Decks')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
  })

  test('sorts alphabetically, reverses, and groups by format', async ({ page }) => {
    const toolbar = page.locator('.toolbar').first()
    const groupSelect = toolbar.locator('select').first()

    // Defaults to alphabetical.
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Aggro Alpha',
      'Midrange Mike',
      'Zoo Zebra',
    ])

    // Reverse flips the current order.
    const reverse = page.locator(REVERSE, { hasText: /^↑↓ Reverse$/ })
    await reverse.click()
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Zoo Zebra',
      'Midrange Mike',
      'Aggro Alpha',
    ])
    await reverse.click()

    // Grouping by format renders one titled section per format, in order of
    // first appearance, with each deck filed under its own format.
    await groupSelect.selectOption('format')
    expect(await page.locator('.deck-index-group-title').allTextContents()).toEqual([
      'Modern',
      'Commander',
    ])
    const groups = page.locator('.deck-index-group')
    expect(await groups.nth(0).locator(NAME).allTextContents()).toEqual([
      'Aggro Alpha',
      'Zoo Zebra',
    ])
    expect(await groups.nth(1).locator(NAME).allTextContents()).toEqual(['Midrange Mike'])
  })
})

test.describe('Collection index toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteIndexLists(page)
    await page.goto('#/collections')
    await expect(page.locator('h1')).toContainText('My Collections')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
  })

  test('grouping selector is omitted; only the sort selector appears', async ({ page }) => {
    const toolbar = page.locator('.toolbar').first()
    await expect(toolbar).toBeVisible()
    // No "Group:" control — only the single Sort selector remains.
    await expect(toolbar.getByText('Group:')).toHaveCount(0)
    await expect(toolbar.locator('select')).toHaveCount(1)
    await expect(toolbar.getByText('Sort:')).toBeVisible()
  })

  test('sort options exclude "Lowest price" (deck-only)', async ({ page }) => {
    const options = await page.locator('.toolbar select option').allTextContents()
    expect(options).toEqual(['Alphabetical', 'Recently updated', 'Current price'])
  })

  test('defaults to alphabetical and re-sorts by current price', async ({ page }) => {
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Alpha Collection',
      'Mid Collection',
      'Zebra Collection',
    ])

    await page.locator('.toolbar select').selectOption('price')
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Zebra Collection',
      'Mid Collection',
      'Alpha Collection',
    ])
  })

  test('reverse flips the current order', async ({ page }) => {
    const before = await page.locator(NAME).allTextContents()
    const reverse = page.locator(REVERSE, { hasText: /^↑↓ Reverse$/ })
    await expect(reverse).not.toHaveClass(/active/)
    await reverse.click()
    await expect(reverse).toHaveClass(/active/)
    expect(await page.locator(NAME).allTextContents()).toEqual([...before].reverse())
  })

  test('recently-updated sort orders newest first', async ({ page }) => {
    await page.locator('.toolbar select').selectOption('recent')
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Alpha Collection', // 2026-05
      'Mid Collection', // 2026-03
      'Zebra Collection', // 2026-01
    ])
  })
})

test.describe('Wanted list index toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteIndexLists(page)
    await page.goto('#/wanted')
    await expect(page.locator('h1')).toContainText('My Wanted Lists')
    await expect(page.locator('.deck-cover').first()).toBeVisible()
  })

  test('grouping selector is omitted; only the sort selector appears', async ({ page }) => {
    const toolbar = page.locator('.toolbar').first()
    await expect(toolbar.getByText('Group:')).toHaveCount(0)
    await expect(toolbar.locator('select')).toHaveCount(1)
  })

  test('defaults to alphabetical and re-sorts by current price', async ({ page }) => {
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Acquire A',
      'Need M',
      'Wishlist Z',
    ])

    await page.locator('.toolbar select').selectOption('price')
    expect(await page.locator(NAME).allTextContents()).toEqual([
      'Wishlist Z',
      'Need M',
      'Acquire A',
    ])
  })
})
