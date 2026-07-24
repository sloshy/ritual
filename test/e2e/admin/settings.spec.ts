import { test, expect, type Route } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import { mockConfigApi, mockTotpApi, MOCK_CONFIG } from '../helpers/mock-admin'

type ConfigPutBody = {
  cacheSource?: string
  cacheFeedUrl?: string
  searchDebounceMs?: number
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
    apiBaseUrl?: string
    bannedPrintings?: string[]
  }
}

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockConfigApi(page)
    await mockTotpApi(page)
    await gotoAdminDashboard(page)
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
    await expect(main.locator('select[name="defaultCurrency"]')).toHaveValue(
      MOCK_CONFIG.defaultCurrency,
    )
    await expect(main.locator('input[name="cacheLockTimeoutSeconds"]')).toHaveValue(
      String(MOCK_CONFIG.cacheLockTimeoutSeconds),
    )
    await expect(main.locator('select[name="cacheSource"]')).toHaveValue(MOCK_CONFIG.cacheSource)
    await expect(main.locator('input[name="cacheFeedUrl"]')).toHaveValue('')
    await expect(main.locator('input[name="searchDebounceMs"]')).toHaveValue(
      String(MOCK_CONFIG.searchDebounceMs),
    )
  })

  test('editing the search debounce persists the new value', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('input[name="searchDebounceMs"]').fill('250')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.searchDebounceMs).toBe(250)
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

  test('switching cache source to feed and setting a feed URL persists both', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('select[name="cacheSource"]').selectOption('feed')
    await main.locator('input[name="cacheFeedUrl"]').fill('https://feed.example.com/feed.json')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.cacheSource).toBe('feed')
    expect(body.cacheFeedUrl).toBe('https://feed.example.com/feed.json')
  })

  test('clearing an existing cache feed URL sends an empty string, not omitting the field', async ({
    page,
  }) => {
    // Serve a config that already has a cacheFeedUrl set, so clearing it is a
    // real state transition rather than a no-op on an already-empty field.
    await fulfillJson(page, '**/api/config', (route: Route) => ({
      success: true,
      config:
        route.request().method() === 'GET'
          ? { ...MOCK_CONFIG, cacheFeedUrl: 'https://feed.example.com/feed.json' }
          : MOCK_CONFIG,
    }))
    await page.reload()
    // A reload resets the hash-routed SPA to the dashboard; navigate back.
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')

    const main = page.locator('main')
    await expect(main.locator('input[name="cacheFeedUrl"]')).toHaveValue(
      'https://feed.example.com/feed.json',
    )
    await main.locator('input[name="cacheFeedUrl"]').fill('')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    // The field must round-trip as an explicit empty string so the admin API's
    // "empty clears cacheFeedUrl" branch actually fires — omitting the key
    // entirely would silently keep the old value.
    expect(body.cacheFeedUrl).toBe('')
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

  test('editing public-site include and exclude lists persists to the config and shows success', async ({
    page,
  }) => {
    const main = page.locator('main')
    await main.locator('textarea[name="includeDecks"]').fill('Izzet Storm\nBlack Panther')
    await main.locator('textarea[name="excludeDecks"]').fill('Old Brew')

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const request = await requestPromise
    const body = JSON.parse(request.postData() ?? '{}') as ConfigPutBody
    expect(body.site?.includeDecks).toEqual(['Izzet Storm', 'Black Panther'])
    expect(body.site?.excludeDecks).toEqual(['Old Brew'])
    // Untouched include lists keep the wildcard default.
    expect(body.site?.includeCollections).toEqual(['*'])
    expect(body.site?.includeWantedLists).toEqual(['*'])
    // Untouched exclude lists stay empty.
    expect(body.site?.excludeCollections).toEqual([])
    // A successful PUT surfaces the success alert.
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
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

  test('setting and clearing the API base URL persists and unsets site.apiBaseUrl', async ({
    page,
  }) => {
    const main = page.locator('main')
    const input = main.locator('input[name="apiBaseUrl"]')
    await input.fill('https://ritual-api.example.com')

    const setRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const setBody = JSON.parse((await setRequestPromise).postData() ?? '{}') as ConfigPutBody
    expect(setBody.site?.apiBaseUrl).toBe('https://ritual-api.example.com')

    // Clearing the input drops the key entirely (fully static site), rather
    // than sending the same-origin empty string.
    await input.fill('')
    const clearRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/config') && req.method() === 'PUT',
    )
    await main.locator('button:has-text("Save")').click()
    const clearBody = JSON.parse((await clearRequestPromise).postData() ?? '{}') as ConfigPutBody
    expect(clearBody.site ?? {}).not.toHaveProperty('apiBaseUrl')
  })
})

test.describe('Settings Page — banned printings prefill', () => {
  test.beforeEach(async ({ page }) => {
    // Serve a config that already has a stored (lowercase) banned printing so the
    // prefill path is exercised. PUTs echo the plain mock config back.
    await fulfillJson(page, '**/api/config', (route: Route) => ({
      success: true,
      config:
        route.request().method() === 'GET'
          ? { ...MOCK_CONFIG, site: { bannedPrintings: ['sld:123'] } }
          : MOCK_CONFIG,
    }))
    await mockTotpApi(page)
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Settings")').click()
    await expect(page.locator('.section-heading')).toContainText('Settings')
  })

  test('prefills stored banned printings with the set code uppercased', async ({ page }) => {
    await expect(page.locator('main textarea[name="bannedPrintings"]')).toHaveValue('SLD:123')
  })
})
