import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'

test.describe('Wanted List Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await openListEditor(page, 'wanted')
  })

  test('wanted list selector is populated with wanted lists', async ({ page }) => {
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const options = select.locator('option')
    expect(await options.count()).toBeGreaterThan(1)
  })

  test('selecting a wanted list loads its content into the editor', async ({ page }) => {
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const options = select.locator('option')
    const value = await options.nth(1).getAttribute('value')
    expect(value).toBeTruthy()
    await select.selectOption(value)
    // Editor should show card items from the wanted list
    const editor = page.locator('.card-item, textarea, .editor-content, [class*="editor"]').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })
  })
})
