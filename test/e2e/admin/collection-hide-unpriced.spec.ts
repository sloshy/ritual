import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import {
  mockAdminCollectionLoadApi,
  mockCollectionsApi,
  mockConfigApi,
} from '../helpers/mock-admin'
import { openFilterMenu } from '../helpers/filter-menu'

test.describe('Collection Editor – Hide Unpriced', () => {
  test.beforeEach(async ({ page }) => {
    await mockCollectionsApi(page)
    await mockAdminCollectionLoadApi(page)

    await gotoAdminDashboard(page)
    await openListEditor(page, 'collection')

    // Wait for the collection selector to be populated
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })

    // Select the test collection
    const select = page.locator('select#collection-select')
    await select.selectOption('test-collection')

    // Wait for card content to appear
    await page.waitForSelector('[data-view]', { timeout: 15_000 })

    // Switch to list view so card names are visible as text
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })
  })

  test('unpriced cards render "N/A" in the price column, priced cards render a price', async ({
    page,
  }) => {
    const unpricedRow = page
      .locator('.card-list')
      .filter({ has: page.getByText('Unpriced Card', { exact: true }) })
    await expect(unpricedRow.locator('.list-price')).toHaveText('N/A')

    const pricedRow = page
      .locator('.card-list')
      .filter({ has: page.getByText('Priced Card', { exact: true }) })
    await expect(pricedRow.locator('.list-price')).toHaveText('$3.50')
    await expect(pricedRow.locator('.list-printing')).toHaveText('(TST:10 · NM)')
  })

  test('prices render in the configured default currency', async ({ page }) => {
    // MOCK_CONFIG carries defaultCurrency: 'eur'; with the config API mocked,
    // a fresh editor mount must price the row in euros instead of USD.
    await mockConfigApi(page)
    await page.reload()
    await openListEditor(page, 'collection')
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    await page.locator('select#collection-select').selectOption('test-collection')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
    await page.locator('[data-view="list"]').click()
    await page.waitForSelector('.card-list', { timeout: 10_000 })

    const pricedRow = page
      .locator('.card-list')
      .filter({ has: page.getByText('Priced Card', { exact: true }) })
    await expect(pricedRow.locator('.list-price')).toHaveText('€2.75')
  })

  test('disabling Hide Unpriced restores unpriced cards', async ({ page }) => {
    await openFilterMenu(page)
    const toggle = page.getByRole('button', { name: 'Hide Unpriced' })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    let cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Priced Card')
    expect(cardNames).not.toContain('Unpriced Card')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    cardNames = await page.locator('.list-name').allTextContents()
    expect(cardNames).toContain('Unpriced Card')
  })
})
