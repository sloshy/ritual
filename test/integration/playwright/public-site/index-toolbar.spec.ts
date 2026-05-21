import { test, expect } from '@playwright/test'
import { mockPublicSiteIndexLists } from '../helpers/mock-data'

const NAME = '.deck-cover .cover-info h2'
const REVERSE = '.toolbar button.toolbar-toggle'

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
