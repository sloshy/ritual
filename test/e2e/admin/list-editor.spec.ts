import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, SELECTOR_ID } from '../helpers/editor-nav'
import { LIST_TYPES, listTypeLabel } from '../../../src/list/list-type'

test.describe('Edit Lists page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
    await page.locator('.admin-nav-item:has-text("Edit Lists")').click()
    await expect(page.locator('.section-heading')).toContainText('Edit Lists')
  })

  test('switching type tabs swaps the mounted editor and its selector', async ({ page }) => {
    // Decks tab is active on open; only the deck selector is mounted.
    await expect(page.locator('.list-type-tab[data-active="true"]:has-text("Decks")')).toBeVisible()
    await expect(page.locator('#deck-select')).toBeVisible()
    await expect(page.locator('#collection-select')).toHaveCount(0)

    await page.locator('.list-type-tab:has-text("Collections")').click()
    await expect(
      page.locator('.list-type-tab[data-active="true"]:has-text("Collections")'),
    ).toBeVisible()
    await expect(page.locator('#collection-select')).toBeVisible()
    await expect(page.locator('#deck-select')).toHaveCount(0)

    await page.locator('.list-type-tab:has-text("Wanted Lists")').click()
    await expect(
      page.locator('.list-type-tab[data-active="true"]:has-text("Wanted Lists")'),
    ).toBeVisible()
    await expect(page.locator('#wanted-list-select')).toBeVisible()
    await expect(page.locator('#collection-select')).toHaveCount(0)
    await expect(page.locator('#deck-select')).toHaveCount(0)
  })

  for (const type of LIST_TYPES) {
    test(`selecting a ${listTypeLabel(type)} loads its content into the editor`, async ({
      page,
    }) => {
      await openListEditor(page, type)
      const select = page.locator(SELECTOR_ID[type])
      await page.waitForFunction(
        (id) => (document.querySelector<HTMLSelectElement>(id)?.options.length ?? 0) > 1,
        SELECTOR_ID[type],
        { timeout: 10_000 },
      )
      const value = await select.locator('option').nth(1).getAttribute('value')
      expect(value).toBeTruthy()
      await select.selectOption(value)
      // Editor should populate with the list's cards.
      const firstCard = page.locator('.card-item').first()
      await expect(firstCard).toBeVisible({ timeout: 10_000 })
      expect((await firstCard.textContent())?.trim().length ?? 0).toBeGreaterThan(0)
    })
  }
})
