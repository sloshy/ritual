import { test, expect } from '@playwright/test'

test.describe('Deck Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a known deck
    await page.goto('#/deck/black-panther')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('deck name is displayed as heading', async ({ page }) => {
    const heading = page.locator('h1, h2').first()
    await expect(heading).toBeVisible()
    await expect(heading).not.toBeEmpty()
  })

  test('card sections are present with section headers', async ({ page }) => {
    const sections = page.locator('.section-divider')
    await expect(sections.first()).toBeVisible()
    expect(await sections.count()).toBeGreaterThan(0)
  })

  test('card images load in binder view', async ({ page }) => {
    const firstImage = page.locator('.card-binder img, .card-item img').first()
    await expect(firstImage).toBeVisible({ timeout: 10_000 })
  })

  test('toolbar is visible', async ({ page }) => {
    const toolbar = page.locator('.view-toggle')
    await expect(toolbar.first()).toBeVisible()
  })

  test('deck shows section headers with card counts', async ({ page }) => {
    const pageText = await page.textContent('body')
    expect(pageText).toMatch(
      /(?:Creature|Instant|Sorcery|Artifact|Enchantment|Land|Planeswalker)\s*\d+/i,
    )
  })
})
