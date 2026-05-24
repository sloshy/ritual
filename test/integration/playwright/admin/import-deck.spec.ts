import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockImportDeckApi } from '../helpers/mock-data'

type ImportPayload = { mode?: string; url?: string; content?: string; name?: string }

test.describe('Import Deck Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Import Deck")').click()
    await expect(page.locator('.section-heading')).toContainText('Import Deck')
  })

  test('URL import sends a url payload and shows success', async ({ page }) => {
    let captured: ImportPayload | undefined
    await mockImportDeckApi(page, (b) => (captured = b as ImportPayload))
    const main = page.locator('main')
    const button = main.locator('button:has-text("Import Deck")')
    await expect(button).toBeDisabled()
    await main.locator('input.form-input').fill('https://archidekt.com/decks/12345')
    await expect(button).toBeEnabled()
    await button.click()
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured).toBeDefined()
    expect(captured?.mode).toBe('url')
    expect(captured?.url).toBe('https://archidekt.com/decks/12345')
  })

  test('switching to Paste Text sends a text payload with the entered name', async ({ page }) => {
    let captured: ImportPayload | undefined
    await mockImportDeckApi(page, (b) => (captured = b as ImportPayload))
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Paste Text")').click()

    const button = main.locator('button:has-text("Import Deck")')
    await expect(button).toBeDisabled()
    await main.locator('textarea.form-textarea').fill('4 Lightning Bolt\n1 Sol Ring')
    await main.locator('input.form-input').fill('My Pasted Deck')
    await expect(button).toBeEnabled()
    await button.click()

    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured).toBeDefined()
    expect(captured?.mode).toBe('text')
    expect(captured?.content).toContain('4 Lightning Bolt')
    expect(captured?.name).toBe('My Pasted Deck')
    // Inputs reset after a successful import.
    await expect(main.locator('textarea.form-textarea')).toHaveValue('')
  })

  test('uploading a file reads it client-side and prefills the deck name', async ({ page }) => {
    let captured: ImportPayload | undefined
    await mockImportDeckApi(page, (b) => (captured = b as ImportPayload))
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Upload File")').click()

    await main.locator('input.file-input-hidden').setInputFiles({
      name: 'burn.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('4 Lightning Bolt\n1 Sol Ring'),
    })
    await expect(main.locator('.file-input-name')).toContainText('burn.txt')
    await expect(main.locator('input.form-input')).toHaveValue('burn')

    await main.locator('button:has-text("Import Deck")').click()
    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured).toBeDefined()
    expect(captured?.mode).toBe('text')
    expect(captured?.content).toContain('4 Lightning Bolt')
    expect(captured?.name).toBe('burn')
  })

  test('a failed import shows an error and no success alert', async ({ page }) => {
    await page.route('**/api/import-deck', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'URL not supported.' }),
      })
    })
    const main = page.locator('main')
    await main.locator('input.form-input').fill('https://example.com/decks/1')
    await main.locator('button:has-text("Import Deck")').click()
    await expect(main.locator('.alert-error')).toContainText('URL not supported.')
    await expect(main.locator('.alert-success')).toHaveCount(0)
  })
})
