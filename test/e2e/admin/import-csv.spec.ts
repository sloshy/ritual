import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import { mockImportCsvApi } from '../helpers/mock-admin'

type ImportCsvPayload = {
  listType?: string
  name?: string
  mode?: string
  format?: string
  content?: string
  columns?: string
  hasHeader?: boolean
}

const CSV_TEXT = 'Name,Set,Collector Number,Quantity\nSol Ring,C19,221,2\nArcane Signet,FDN,266,1'

test.describe('Import CSV Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Import CSV")').click()
    await expect(page.locator('.section-heading')).toContainText('Import CSV')
  })

  test('pasting CSV guesses the column mapping and imports a new collection', async ({ page }) => {
    let captured: ImportCsvPayload | undefined
    await mockImportCsvApi(page, (b) => (captured = b as ImportCsvPayload))
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    const button = main.locator('button[type="submit"]')
    await expect(button).toBeDisabled()
    await main.locator('textarea.form-textarea').fill(CSV_TEXT)

    // Header detection and column guesses come from the pasted content.
    await expect(main.locator('.checkbox-label input[type="checkbox"]').first()).toBeChecked()
    await expect(main.locator('select[data-field="name"]')).toHaveValue('0')
    await expect(main.locator('select[data-field="quantity"]')).toHaveValue('3')
    await expect(main.getByText('2 data rows detected')).toBeVisible()

    await main.locator('input.form-input').fill('Red Binder')
    await expect(button).toBeEnabled()
    await button.click()

    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured).toBeDefined()
    expect(captured?.listType).toBe('collection')
    expect(captured?.mode).toBe('create')
    expect(captured?.name).toBe('Red Binder')
    expect(captured?.columns).toBe('name=1,set=2,collector-number=3,quantity=4')
    expect(captured?.hasHeader).toBe(true)
    expect(captured?.content).toContain('Sol Ring')
  })

  test('append mode lists existing collections and sends mode=append', async ({ page }) => {
    let captured: ImportCsvPayload | undefined
    await mockImportCsvApi(page, (b) => (captured = b as ImportCsvPayload))
    await fulfillJson(page, '**/api/collections', {
      collections: [{ slug: 'main-binder', name: 'Main Binder' }],
    })
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(CSV_TEXT)
    await main.locator('.segmented-option:has-text("Append to Existing")').click()

    await main.locator('select.csv-target').selectOption('main-binder')

    const button = main.locator('button:has-text("Append Cards")')
    await expect(button).toBeEnabled()
    await button.click()

    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured?.mode).toBe('append')
    expect(captured?.name).toBe('main-binder')
  })

  test('row failures from the server are listed with line numbers', async ({ page }) => {
    await mockImportCsvApi(page, undefined, [
      { lineNumber: 3, raw: 'Arcane Signet,,', reason: 'Missing set code' },
    ])
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(CSV_TEXT)
    await main.locator('input.form-input').fill('Red Binder')
    await main.locator('button[type="submit"]').click()

    await expect(main.locator('.csv-failures')).toBeVisible({ timeout: 5000 })
    await expect(main.locator('.csv-failures li')).toContainText('Line 3')
    await expect(main.locator('.csv-failures li')).toContainText('Missing set code')
    // A partial import still succeeded, so the success banner shows alongside.
    await expect(main.locator('.alert-success')).toBeVisible()
  })

  test('changing the CSV content clears the previous import outcome', async ({ page }) => {
    // The banner and the failure list describe the CSV that was submitted, so
    // loading a different one has to retire them — otherwise the page reports
    // the previous file's result above the new one.
    await mockImportCsvApi(page, undefined, [
      { lineNumber: 3, raw: 'Arcane Signet,,', reason: 'Missing set code' },
    ])
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(CSV_TEXT)
    await main.locator('input.form-input').fill('Red Binder')
    await main.locator('button[type="submit"]').click()

    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    await expect(main.locator('.csv-failures')).toBeVisible()

    await main.locator('textarea.form-textarea').fill('Name,Set\nSol Ring,C19')

    await expect(main.locator('.alert-success')).toHaveCount(0)
    await expect(main.locator('.csv-failures')).toHaveCount(0)
  })

  test('a deck import requires picking a format and sends it', async ({ page }) => {
    let captured: ImportCsvPayload | undefined
    await mockImportCsvApi(page, (b) => (captured = b as ImportCsvPayload))
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill('Quantity,Name\n4,Lightning Bolt')
    await main.locator('select.csv-list-type').selectOption('deck')
    await main.locator('input.form-input').fill('Burn')
    await main.locator('select.csv-format').selectOption('modern')

    await main.locator('button[type="submit"]').click()
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured?.listType).toBe('deck')
    expect(captured?.format).toBe('modern')
    expect(captured?.columns).toBe('name=2,quantity=1')
  })
})
