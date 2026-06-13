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
    excludeDecks?: string[]
    excludeCollections?: string[]
    excludeWantedLists?: string[]
    bannedPrintings?: string[]
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

  test('public-site include lists default to the wildcard and exclude lists are empty', async ({
    page,
  }) => {
    const main = page.locator('main')
    await expect(main.locator('textarea[name="includeDecks"]')).toHaveValue('*')
    await expect(main.locator('textarea[name="includeCollections"]')).toHaveValue('*')
    await expect(main.locator('textarea[name="includeWantedLists"]')).toHaveValue('*')
    await expect(main.locator('textarea[name="excludeDecks"]')).toHaveValue('')
    await expect(main.locator('textarea[name="excludeCollections"]')).toHaveValue('')
    await expect(main.locator('textarea[name="excludeWantedLists"]')).toHaveValue('')
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
    // Untouched exclude lists stay empty.
    expect(body.site?.excludeDecks).toEqual([])
  })

  test('editing a public-site exclude list persists to the config', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('textarea[name="excludeDecks"]').fill('Old Brew')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.site?.excludeDecks).toEqual(['Old Brew'])
    // Include lists keep the wildcard default.
    expect(body.site?.includeDecks).toEqual(['*'])
  })

  test('editing banned default printings persists to the config', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('textarea[name="bannedPrintings"]').fill('SLD:123\nMH2:42')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.site?.bannedPrintings).toEqual(['SLD:123', 'MH2:42'])
  })
})

test.describe('Settings Page — banned printings prefill', () => {
  test.beforeEach(async ({ page }) => {
    // Serve a config that already has a stored (lowercase) banned printing so the
    // prefill path is exercised. PUTs echo the plain mock config back.
    await page.route('**/api/config', async (route) => {
      const config =
        route.request().method() === 'GET'
          ? { ...MOCK_CONFIG, site: { bannedPrintings: ['sld:123'] } }
          : MOCK_CONFIG
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, config }),
      })
    })
    await mockTotpApi(page)
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
  })

  test('prefills stored banned printings with the set code uppercased', async ({ page }) => {
    await expect(page.locator('main textarea[name="bannedPrintings"]')).toHaveValue('SLD:123')
  })
})
