import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'

/** A change bundle as the public site would export it: a set-finish on an existing card plus a new add. */
const CHANGE_BUNDLE = JSON.stringify({
  format: 'ritual-change-bundle',
  version: 1,
  exportedAt: '2026-06-04T00:00:00.000Z',
  lists: [
    {
      kind: 'deck',
      slug: 'test-unset-commander',
      name: 'Test',
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
    },
  ],
})

test.describe('Import changes (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
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

    await dialog.locator('.import-dialog-textarea').fill(CHANGE_BUNDLE)
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    // Both changes resolve (set-finish by name, add with a fresh ID) — no conflicts.
    await expect(dialog).toContainText('Loaded 2 changes')
    await dialog.getByRole('button', { name: 'Done' }).click()

    // The pending changes are now staged in the editor for review + save.
    await expect(page.locator('.changes-badge')).toHaveText('2')
  })

  test('rejects bundles that do not match this list', async ({ page }) => {
    await page.locator('.btn-import').click()
    const dialog = page.locator('.import-dialog')

    // A bundle whose only list is the wrong kind.
    const wrongKind = JSON.parse(CHANGE_BUNDLE) as { lists: { kind: string }[] }
    wrongKind.lists[0]!.kind = 'collection'
    await dialog.locator('.import-dialog-textarea').fill(JSON.stringify(wrongKind))
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(dialog).toContainText('no changes for a deck (it targets: collection)')

    // A bundle whose same-kind lists all target other slugs.
    const deckList = (slug: string) => ({
      kind: 'deck',
      slug,
      name: slug,
      changes: [{ id: slug, timestamp: 1, action: 'add', cardName: 'Sol Ring' }],
    })
    await dialog.locator('.import-dialog-textarea').fill(
      JSON.stringify({
        format: 'ritual-change-bundle',
        version: 1,
        exportedAt: '2026-06-04T00:00:00.000Z',
        lists: [deckList('some-other-deck'), deckList('yet-another-deck')],
      }),
    )
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(dialog).toContainText('none match this list')

    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('picks the matching list out of a multi-list bundle', async ({ page }) => {
    await page.locator('.btn-import').click()
    const dialog = page.locator('.import-dialog')
    await dialog.locator('.import-dialog-textarea').fill(
      JSON.stringify({
        format: 'ritual-change-bundle',
        version: 1,
        exportedAt: '2026-06-04T00:00:00.000Z',
        lists: [
          {
            kind: 'collection',
            slug: 'other',
            name: 'Other',
            changes: [{ id: 'x', timestamp: 1, action: 'add', cardName: 'Sol Ring' }],
          },
          {
            kind: 'deck',
            slug: 'test-unset-commander',
            name: 'Test',
            changes: [{ id: 'b', timestamp: 2, action: 'add', cardName: 'Counterspell' }],
          },
        ],
      }),
    )
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()

    // Only the deck entry matching this editor loads; the collection entry is ignored.
    await expect(dialog).toContainText('Loaded 1 change')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('.changes-badge')).toHaveText('1')
  })
})
