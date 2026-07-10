import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('page loads with correct title', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('header')).toContainText('Ritual')
  })

  test('deck cards are rendered in a grid', async ({ page }) => {
    await page.goto('/')
    const deckCards = page.locator('.deck-cover')
    await expect(deckCards.first()).toBeVisible()
    expect(await deckCards.count()).toBeGreaterThan(0)
  })

  test('collections tab shows collection cards', async ({ page }) => {
    await page.goto('#/collections')
    await expect(page.locator('h1')).toContainText('My Collections')
    const collectionCards = page.locator('.deck-cover')
    await expect(collectionCards.first()).toBeVisible()
  })
})
