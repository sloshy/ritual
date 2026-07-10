import { test, expect } from '@playwright/test'
import { mockPublicSiteForQuickSwitch } from '../helpers/mock-public-site'

// Hash-router navigation, driven entirely by the mocked quick-switch site
// (two decks, one collection, one wanted list, plus their detail JSONs).
test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForQuickSwitch(page)
  })

  test('routing round-trip through deck, collection, and wanted pages', async ({ page }) => {
    // Home shows the deck index.
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('My Decks')

    // Clicking a deck card opens that deck's page.
    await page.locator('a[href="#/deck/azorius-control"]').click()
    await expect(page.locator('h1.page-title')).toHaveText('Azorius Control')

    // The browser back button returns to the deck index.
    await page.goBack()
    await expect(page.locator('h1')).toContainText('My Decks')

    // The Collections nav link opens the collection index, and a collection
    // card opens that collection's page.
    await page.locator('a[href="#/collections"]').click()
    await expect(page.locator('h1')).toContainText('My Collections')
    await page.locator('a[href="#/collection/main-binder"]').click()
    await expect(page.locator('h1.page-title')).toHaveText('Main Binder')

    // The Wanted nav link opens the wanted list index.
    await page.locator('a[href="#/wanted"]').click()
    await expect(page.locator('h1')).toContainText('My Wanted Lists')

    // The header logo returns home.
    await page.locator('a[href="#/"]').first().click()
    await expect(page.locator('h1')).toContainText('My Decks')
  })

  test('direct hash URL deep-links to a deck page', async ({ page }) => {
    await page.goto('#/deck/mono-red-aggro')
    await page.waitForSelector('[data-view]', { timeout: 10_000 })
    await expect(page.locator('h1.page-title')).toHaveText('Mono Red Aggro')
  })
})
