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

  test.describe('unset commander', () => {
    test.beforeEach(async ({ page }) => {
      // Load the fake test deck
      const select = page.locator('select').first()
      await page.waitForFunction(
        () => (document.querySelector('select')?.options.length ?? 0) > 1,
        {
          timeout: 10_000,
        },
      )
      await select.selectOption('test-unset-commander')
      // Wait for deck card items to load
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    test('commander card shows "Unset as Commander" in context menu', async ({ page }) => {
      // Find the context menu button for Sol Ring (in Commander section)
      const cardItem = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(cardItem).toBeVisible({ timeout: 10_000 })

      const contextBtn = cardItem.locator('.edit-btn-context')
      await contextBtn.click()

      const menu = page.locator('.card-context-menu')
      await expect(menu).toBeVisible()
      await expect(menu.locator('button', { hasText: 'Unset as Commander' })).toBeVisible()
      await expect(menu.locator('button', { hasText: /^Set as Commander$/ })).toHaveCount(0)
    })

    test('non-commander card shows "Set as Commander" in context menu', async ({ page }) => {
      // Lightning Bolt is in the Main section, not Commander
      const cardItem = page.locator('.card-item').filter({ hasText: 'Lightning Bolt' }).first()
      await expect(cardItem).toBeVisible({ timeout: 10_000 })

      const contextBtn = cardItem.locator('.edit-btn-context')
      await contextBtn.click()

      const menu = page.locator('.card-context-menu')
      await expect(menu).toBeVisible()
      await expect(menu.locator('button', { hasText: 'Set as Commander' })).toBeVisible()
      await expect(menu.locator('button', { hasText: 'Unset as Commander' })).toHaveCount(0)
    })

    test('clicking "Unset as Commander" moves card out of commander section', async ({ page }) => {
      // Open context menu on Sol Ring (currently in Commander section)
      const commanderCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(commanderCard).toBeVisible({ timeout: 10_000 })
      await commanderCard.locator('.edit-btn-context').click()

      const menu = page.locator('.card-context-menu')
      await expect(menu).toBeVisible()
      await menu.locator('button', { hasText: 'Unset as Commander' }).click()

      // Verify the change badge shows a pending change
      const changesBadge = page.locator('.changes-badge')
      await expect(changesBadge).toBeVisible({ timeout: 5_000 })

      // Re-open context menu on Sol Ring — it should now show "Set as Commander"
      const movedCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(movedCard).toBeVisible()
      await movedCard.locator('.edit-btn-context').click()

      const menu2 = page.locator('.card-context-menu')
      await expect(menu2).toBeVisible()
      await expect(menu2.locator('button', { hasText: 'Set as Commander' })).toBeVisible()
    })

    test('set-commander after unset-commander cancels the change', async ({ page }) => {
      // Unset Sol Ring as commander
      const commanderCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(commanderCard).toBeVisible({ timeout: 10_000 })
      await commanderCard.locator('.edit-btn-context').click()
      await page.locator('.card-context-menu button', { hasText: 'Unset as Commander' }).click()

      // Changes badge should appear (1 pending change)
      await expect(page.locator('.changes-badge')).toBeVisible({ timeout: 5_000 })

      // Now set it back as commander — should cancel the unset
      const movedCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(movedCard).toBeVisible()
      await movedCard.locator('.edit-btn-context').click()
      await page.locator('.card-context-menu button', { hasText: 'Set as Commander' }).click()

      // The two changes cancel out — badge should be gone (no pending changes)
      await expect(page.locator('.changes-badge')).toHaveCount(0)
    })
  })
})
