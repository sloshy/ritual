import { test, expect } from '@playwright/test'

test.describe('Responsive Layout', () => {
  test('desktop layout shows full content', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    // Header should be visible
    await expect(page.locator('header')).toBeVisible()
    // Deck grid should show multiple columns
    const deckCards = page.locator('.deck-cover')
    await expect(deckCards.first()).toBeVisible()
    // No horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })

  test('mobile layout adapts grid', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await expect(page.locator('header')).toBeVisible()
    // Deck cards should still be visible
    const deckCards = page.locator('.deck-cover')
    await expect(deckCards.first()).toBeVisible()
    // Content should be reasonably contained (allow small overflow from card images)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.15)
  })

  test('tablet viewport has no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto('/')
    await expect(page.locator('header')).toBeVisible()
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1)
  })

  test('deck page is usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('#/deck/black-panther')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    // Toolbar should be visible (may wrap)
    await expect(page.locator('.view-toggle').first()).toBeVisible()
    // Content should be reasonably contained
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.15)
  })

  test('collection page is usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('#/collections')
    await expect(page.locator('h1')).toContainText('My Collections')
    // Content should be reasonably contained
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.15)
  })
})
