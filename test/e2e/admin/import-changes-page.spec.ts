import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockImportChangesApi } from '../helpers/mock-data'

const BUNDLE = {
  format: 'ritual-change-bundle',
  version: 1,
  exportedAt: '2026-06-04T00:00:00.000Z',
  lists: [
    {
      kind: 'deck',
      slug: 'my-deck',
      name: 'My Deck',
      changes: [
        { id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' },
        { id: 'r1', timestamp: 2, action: 'remove', cardName: 'Lightning Bolt', cardId: 2 },
      ],
    },
    {
      kind: 'collection',
      slug: 'binder',
      name: 'Binder',
      changes: [{ id: 'a2', timestamp: 3, action: 'add', cardName: 'Sol Ring' }],
    },
  ],
}

test.describe('Import Changes Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Import Changes")').click()
    await expect(page.locator('.section-heading')).toContainText('Import Changes')
  })

  test('pasting a bundle previews every change per list, then applies it', async ({ page }) => {
    let captured: unknown
    await mockImportChangesApi(
      page,
      [
        { kind: 'deck', slug: 'my-deck', name: 'My Deck', applied: 2, conflicts: [] },
        { kind: 'collection', slug: 'binder', name: 'Binder', applied: 1, conflicts: [] },
      ],
      (body) => (captured = body),
    )
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(JSON.stringify(BUNDLE))

    // The preview groups all pending changes by target list, with counts.
    await expect(main.getByText('3 changes across 2 lists')).toBeVisible()
    const groups = main.locator('.import-changes-preview-group')
    await expect(groups).toHaveCount(2)
    await expect(groups.nth(0)).toContainText("My Deck (deck 'my-deck') — 2 changes")
    await expect(groups.nth(0)).toContainText('Add Counterspell')
    await expect(groups.nth(0)).toContainText('Remove Lightning Bolt')
    await expect(groups.nth(1)).toContainText("Binder (collection 'binder') — 1 change")
    await expect(groups.nth(1)).toContainText('Add Sol Ring')

    // Applying is an explicit confirmation of the previewed changes.
    const apply = main.locator('button', { hasText: 'Apply 3 changes to 2 lists' })
    await apply.click()

    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    await expect(main.locator('.import-changes-result')).toHaveCount(2)
    await expect(main.locator('.import-changes-result').nth(0)).toContainText('applied 2 changes')
    expect(captured).toEqual(BUNDLE)
  })

  test('uploading a change file previews and applies it', async ({ page }) => {
    let captured: unknown
    await mockImportChangesApi(
      page,
      [{ kind: 'deck', slug: 'my-deck', name: 'My Deck', applied: 2, conflicts: [] }],
      (body) => (captured = body),
    )
    const main = page.locator('main')

    // Upload is the page's default source method — no segmented-control click needed.
    const file = { ...BUNDLE, lists: [BUNDLE.lists[0]] }
    await main.locator('input[type="file"]').setInputFiles({
      name: 'edits.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    })
    await expect(main.locator('.file-input-name')).toHaveText('edits.json')

    await expect(main.getByText('2 changes across 1 list')).toBeVisible()
    await main.locator('button', { hasText: 'Apply 2 changes to 1 list' }).click()

    await expect(main.locator('.alert-success')).toBeVisible({ timeout: 5000 })
    expect(captured).toEqual(file)
  })

  test('reports per-list conflicts and errors from the apply', async ({ page }) => {
    await mockImportChangesApi(page, [
      {
        kind: 'deck',
        slug: 'my-deck',
        name: 'My Deck',
        applied: 1,
        conflicts: [
          {
            change: { id: 'r9', timestamp: 9, action: 'remove', cardName: 'Ghost Card' },
            reason: 'target-not-found',
          },
        ],
      },
      {
        kind: 'collection',
        slug: 'binder',
        name: 'Binder',
        applied: 0,
        conflicts: [],
        error: "Collection 'binder' not found",
      },
    ])
    const main = page.locator('main')

    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(JSON.stringify(BUNDLE))
    await main.locator('button', { hasText: 'Apply 3 changes to 2 lists' }).click()

    await expect(main.locator('.alert-error')).toBeVisible({ timeout: 5000 })
    const results = main.locator('.import-changes-result')
    await expect(results.nth(0)).toContainText('Skipped (card not found): Remove Ghost Card')
    await expect(results.nth(1)).toContainText("Collection 'binder' not found")
    await expect(results.nth(1)).toHaveAttribute('data-error', 'true')
  })

  test('rejects invalid JSON with a parse error and no apply button', async ({ page }) => {
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill('{"format":"other"}')

    await expect(main.locator('.alert-error')).toContainText('Invalid change bundle')
    await expect(main.locator('button', { hasText: 'Apply' })).toHaveCount(0)
  })

  test('accepts a one-list bundle as a single-list preview', async ({ page }) => {
    const bundle = {
      format: 'ritual-change-bundle',
      version: 1,
      exportedAt: '2026-06-04T00:00:00.000Z',
      lists: [
        {
          kind: 'wanted',
          slug: 'wish',
          name: 'Wish List',
          changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Brainstorm' }],
        },
      ],
    }
    const main = page.locator('main')
    await main.locator('.segmented-option:has-text("Paste Text")').click()
    await main.locator('textarea.form-textarea').fill(JSON.stringify(bundle))

    await expect(main.getByText('1 change across 1 list')).toBeVisible()
    await expect(main.locator('.import-changes-preview-group')).toContainText(
      "Wish List (wanted list 'wish') — 1 change",
    )
    await expect(main.locator('button', { hasText: 'Apply 1 change to 1 list' })).toBeVisible()
  })
})
