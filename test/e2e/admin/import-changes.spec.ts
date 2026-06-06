import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'

/** A change file as the public site would export it: a set-finish on an existing card plus a new add. */
const CHANGE_FILE = JSON.stringify({
  format: 'ritual-change-file',
  version: 1,
  kind: 'deck',
  slug: 'test-unset-commander',
  name: 'Test',
  exportedAt: '2026-06-04T00:00:00.000Z',
  changes: [
    // Exported ID 9999 won't exist in the live deck → re-targets to Sol Ring by name.
    {
      id: 'a',
      timestamp: 1,
      action: 'set-finish',
      cardName: 'Sol Ring',
      finish: 'foil',
      cardId: 9999,
    },
    // A brand-new card → gets a fresh ID on import.
    { id: 'b', timestamp: 2, action: 'add', cardName: 'Counterspell' },
  ],
})

test.describe('Import changes (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await openListEditor(page, 'deck')
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    await select.selectOption('test-unset-commander')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  test('importing a change file loads its changes as pending edits', async ({ page }) => {
    await page.locator('.btn-import').click()
    const dialog = page.locator('.import-dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('.import-dialog-textarea').fill(CHANGE_FILE)
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    // Both changes resolve (set-finish by name, add with a fresh ID) — no conflicts.
    await expect(dialog).toContainText('Loaded 2 changes')
    await dialog.getByRole('button', { name: 'Done' }).click()

    // The pending changes are now staged in the editor for review + save.
    await expect(page.locator('.changes-badge')).toHaveText('2')
  })

  test('rejects a change file for the wrong list kind', async ({ page }) => {
    await page.locator('.btn-import').click()
    const dialog = page.locator('.import-dialog')
    await dialog
      .locator('.import-dialog-textarea')
      .fill(JSON.stringify({ ...JSON.parse(CHANGE_FILE), kind: 'collection' }))
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    await expect(dialog).toContainText("for a collection, but you're editing a deck")
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })
})
