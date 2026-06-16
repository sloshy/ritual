import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'

/**
 * Multi-select on the admin list editors. The selection checkbox and
 * "Selected (N)" menu work the same as on the public site, but the admin has no
 * trade page, so the menu offers only the copy actions — "Add to Trade" is
 * intentionally absent.
 */
test.describe('Admin list multi-select', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await openListEditor(page, 'deck')
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const value = await select.locator('option').nth(1).getAttribute('value')
    await select.selectOption(value)
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  test('selecting a card shows the menu with copy actions but no trade action', async ({
    page,
  }) => {
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)

    const first = page.locator('.card-item').first()
    await first.locator('.card-binder').hover()
    await first.locator('.card-select-checkbox').click()

    const btn = page.locator('.selection-menu-btn')
    await expect(btn).toHaveText(/Selected \(1\)/)

    await btn.click()
    const panel = page.locator('.selection-menu-panel')
    await expect(panel.locator('.selection-menu-item', { hasText: 'Copy as Text' })).toBeVisible()
    await expect(panel.locator('.selection-menu-item', { hasText: 'Copy as CSV' })).toBeVisible()
    await expect(panel.locator('.selection-menu-item', { hasText: 'Add to Trade' })).toHaveCount(0)

    await panel.locator('.selection-menu-item', { hasText: 'Clear selection' }).click()
    await expect(page.locator('.selection-menu-btn')).toHaveCount(0)
  })

  test('the cross-list navbar offers a server-backed "Remove all selected"', async ({ page }) => {
    // Capture the request to the atomic remove endpoint and stub a success response
    // so the test never mutates real list files.
    let removeBody: { removes?: unknown[] } | null = null
    await page.route('**/api/remove/commit', async (route) => {
      removeBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          removed: 1,
          requested: 1,
          skipped: 0,
          message: 'ok',
        }),
      })
    })
    page.on('dialog', (dialog) => void dialog.accept())

    const first = page.locator('.card-item').first()
    await first.locator('.card-binder').hover()
    await first.locator('.card-select-checkbox').click()

    // The navbar "All Selected" menu spans every list and carries the remove action.
    const navbar = page.locator('.selection-menu-btn--navbar')
    await expect(navbar).toHaveText(/All Selected \(1\)/)
    await navbar.click()
    await page
      .locator('.selection-menu-panel .selection-menu-item', { hasText: 'Remove all selected' })
      .click()

    await expect.poll(() => removeBody).not.toBeNull()
    const removes = (removeBody!.removes ?? []) as Array<{
      listType: string
      listSlug: string
      name: string
      cardId?: number
    }>
    expect(removes.length).toBeGreaterThan(0)
    const firstRemove = removes[0]!
    expect(firstRemove.listType).toBe('deck')
    expect(firstRemove.listSlug).toBeTruthy()
    expect(firstRemove.name.length).toBeGreaterThan(0)
    expect(typeof firstRemove.cardId).toBe('number')
    // A successful removal clears the cross-list selection.
    await expect(navbar).toHaveCount(0)
  })
})
