import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockConfigApi, mockTotpApi, MOCK_CONFIG } from '../helpers/mock-data'

type ConfigPutBody = {
  admin?: {
    gitEnabled?: boolean
    gitAutoCommit?: boolean
  }
  site?: {
    includeDecks?: string[]
    includeCollections?: string[]
    includeWantedLists?: string[]
  }
}

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigApi(page)
    await mockTotpApi(page)
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
  })

  test('directory path inputs are pre-populated from config', async ({ page }) => {
    const main = page.locator('main')
    await expect(
      main.locator('input[name="decksDir"], input[placeholder*="decks" i]').first(),
    ).toHaveValue(MOCK_CONFIG.decksDir)
    await expect(
      main.locator('input[name="collectionsDir"], input[placeholder*="collection" i]').first(),
    ).toHaveValue(MOCK_CONFIG.collectionsDir)
  })

  test('save button triggers API call and shows success', async ({ page }) => {
    const main = page.locator('main')
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/config') && resp.request().method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    await responsePromise
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  })

  test('public-site include lists default to the wildcard', async ({ page }) => {
    const main = page.locator('main')
    await expect(main.locator('textarea[name="includeDecks"]')).toHaveValue('*')
    await expect(main.locator('textarea[name="includeCollections"]')).toHaveValue('*')
    await expect(main.locator('textarea[name="includeWantedLists"]')).toHaveValue('*')
  })

  test('toggling an admin setting persists under the nested admin key', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('label:has-text("Enable Git integration") input[type="checkbox"]').check()

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.admin?.gitEnabled).toBe(true)
  })

  test('editing a public-site include list persists to the config', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('textarea[name="includeDecks"]').fill('Izzet Storm\nBlack Panther')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.site?.includeDecks).toEqual(['Izzet Storm', 'Black Panther'])
    // Untouched lists keep the wildcard default.
    expect(body.site?.includeCollections).toEqual(['*'])
    expect(body.site?.includeWantedLists).toEqual(['*'])
  })
})
