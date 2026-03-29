import { test, expect } from '@playwright/test'

type ViewportConfig = {
  name: string
  width: number
  height: number
  maxOverflowRatio: number
}

const viewports: ViewportConfig[] = [
  { name: 'desktop', width: 1280, height: 720, maxOverflowRatio: 1.0 },
  { name: 'tablet', width: 768, height: 1024, maxOverflowRatio: 1.0 },
  { name: 'mobile', width: 375, height: 667, maxOverflowRatio: 1.15 },
]

test.describe('Responsive Layout', () => {
  for (const viewport of viewports) {
    test(`${viewport.name} homepage has no excessive overflow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/')
      await expect(page.locator('.deck-cover').first()).toBeVisible()
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth * viewport.maxOverflowRatio + 1)
    })
  }

  test('deck page is usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('#/deck/black-panther')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    // Verify toolbar is interactive
    await expect(page.locator('.view-toggle').first()).toBeVisible()
    await page.locator('[data-view="list"]').click()
    await expect(page.locator('[data-view="list"]')).toHaveClass(/active/)
    // Verify content is reasonably contained
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.15)
  })

  test('collection page is usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('#/collections')
    await expect(page.locator('h1')).toContainText('My Collections')
    // Click into a collection to verify it works on mobile
    const firstLink = page.locator('a[href^="#/collection/"]').first()
    await expect(firstLink).toBeVisible()
    await firstLink.click()
    await page.waitForSelector('.section-divider', { timeout: 10_000 })
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.15)
  })
})
