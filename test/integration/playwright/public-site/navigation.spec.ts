import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('clicking a deck card navigates to deck page', async ({ page }) => {
    await page.goto('/')
    // Get first deck link's href
    const firstLink = page.locator('a[href^="#/deck/"]').first()
    const href = await firstLink.getAttribute('href')
    await firstLink.click()
    // URL should update
    await page.waitForURL(`**/${href}`)
    // Should no longer show the index page
    await expect(page.locator('h1, h2').first()).not.toContainText('My Decks')
  })

  test('clicking a collection card navigates to collection page', async ({ page }) => {
    await page.goto('#/collections')
    const firstLink = page.locator('a[href^="#/collection/"]').first()
    await firstLink.click()
    expect(page.url()).toContain('#/collection/')
  })

  test('header Ritual logo navigates to home', async ({ page }) => {
    await page.goto('#/deck/black-panther')
    await page.locator('a[href="#/"]').first().click()
    await expect(page.locator('h1')).toContainText('My Decks')
  })

  test('browser back button returns to previous page', async ({ page }) => {
    await page.goto('/')
    await page.locator('a[href^="#/deck/"]').first().click()
    await page.waitForTimeout(500)
    await page.goBack()
    await expect(page.locator('h1')).toContainText('My Decks')
  })

  test('direct hash URL loads correct page', async ({ page }) => {
    await page.goto('#/deck/black-panther')
    // Should show the deck name
    await page.waitForSelector('.deck-cover, h1, h2', { timeout: 10_000 })
  })

  test('Decks and Collections nav links work', async ({ page }) => {
    await page.goto('/')
    // Click Collections nav
    await page.locator('a[href="#/collections"]').click()
    await expect(page.locator('h1')).toContainText('My Collections')
    // Click Decks nav back
    await page.locator('a[href="#/"]').first().click()
    await expect(page.locator('h1')).toContainText('My Decks')
  })

  test('Wanted Lists nav link navigates to wanted lists tab', async ({ page }) => {
    await page.goto('/')
    await page.locator('a[href="#/wanted"]').click()
    await expect(page.locator('h1')).toContainText('My Wanted Lists')
  })

  test('prices date disclaimer is shown', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Prices accurate as of')).toBeVisible()
  })
})
