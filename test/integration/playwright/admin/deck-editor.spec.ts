import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

test.describe('Deck Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-nav-item:has-text("Deck Editor")').click()
    await expect(page.locator('.section-heading')).toContainText('Deck Editor')
  })

  test('deck selector is populated with decks', async ({ page }) => {
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const options = select.locator('option')
    expect(await options.count()).toBeGreaterThan(1)
  })

  test('selecting a deck loads its content into the editor', async ({ page }) => {
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const options = select.locator('option')
    const value = await options.nth(1).getAttribute('value')
    expect(value).toBeTruthy()
    await select.selectOption(value!)
    // Editor should populate with deck content (textarea or editor element)
    const editor = page.locator('textarea, .editor-content, [class*="editor"]').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })
    const content = await editor.inputValue().catch(() => editor.textContent())
    expect((content ?? '').trim().length).toBeGreaterThan(0)
  })
})
