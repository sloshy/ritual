import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'

const MOCK_SOL_RING = {
  id: 'sol-ring-id',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '2.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'c21',
  set_name: 'Commander 2021',
  collector_number: '167',
  rarity: 'uncommon',
  color_identity: [],
}

test.describe('Collection Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await openListEditor(page, 'collection')
  })

  test('collection selector is populated with collections', async ({ page }) => {
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const options = select.locator('option')
    expect(await options.count()).toBeGreaterThan(1)
  })

  test('selecting a collection loads its content into the editor', async ({ page }) => {
    const select = page.locator('select').first()
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, {
      timeout: 10_000,
    })
    const options = select.locator('option')
    const value = await options.nth(1).getAttribute('value')
    expect(value).toBeTruthy()
    await select.selectOption(value)
    // Editor should populate with the collection's cards.
    const firstCard = page.locator('.card-item').first()
    await expect(firstCard).toBeVisible({ timeout: 10_000 })
    expect((await firstCard.textContent())?.trim().length ?? 0).toBeGreaterThan(0)
  })
})

test.describe('Collection Editor sections', () => {
  let savedBody: { changes: { action: string }[]; sectionOrder: string[] } | null

  test.beforeEach(async ({ page }) => {
    savedBody = null
    await loginAsAdmin(page)

    await page.route('**/api/collections', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ collections: [{ slug: 'test-sections', name: 'Test Sections' }] }),
        })
      } else {
        await route.continue()
      }
    })

    await page.route('**/api/collection/test-sections', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          slug: 'test-sections',
          entries: [
            {
              name: 'Sol Ring',
              set: 'c21',
              collectorNumber: '167',
              finish: 'nonfoil',
              condition: 'NM',
              price: 0,
              fileOrder: 0,
              section: 'Main',
              cardId: 1,
            },
          ],
          sectionOrder: ['Main'],
          cards: { 'c21:167': MOCK_SOL_RING, 'Sol Ring': MOCK_SOL_RING },
          printings: { 'Sol Ring': [MOCK_SOL_RING] },
          symbolMap: {},
          contentHash: 'hash-1',
        }),
      })
    })

    await page.route('**/api/collection/test-sections/save', async (route) => {
      savedBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Saved', contentHash: 'hash-2' }),
      })
    })

    await openListEditor(page, 'collection')
    const select = page.locator('#collection-select')
    await page.waitForFunction(
      () => (document.querySelector('#collection-select') as HTMLSelectElement)?.options.length > 1,
      { timeout: 10_000 },
    )
    await select.selectOption('test-sections')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  test('add a section, move a card into it, and save persists both changes', async ({ page }) => {
    // Open the Manage Sections dialog and add a new section.
    await page.locator('.btn-sections').click()
    await page.locator('.section-manager-input').fill('Foils')
    await page.locator('.section-manager-add-btn').click()

    // The new section appears in the manager and a change is pending.
    await expect(page.locator('.section-manager-name', { hasText: 'Foils' })).toBeVisible()
    await expect(page.locator('.changes-badge')).toHaveText('1')

    // Close the dialog before reaching for the card grid behind it.
    await page.keyboard.press('Escape')

    // Move Sol Ring into the new section via its context menu.
    const card = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
    await card.locator('.edit-btn-context').click()
    const menu = page.locator('.card-context-menu')
    await expect(menu).toBeVisible()
    await menu.locator('.card-context-menu-item', { hasText: 'Move to section…' }).click()
    await page.locator('.move-picker-item', { hasText: /^Foils$/ }).click()

    await expect(page.locator('.changes-badge')).toHaveText('2')

    // Save and assert the request carried exactly the add-section and set-section changes
    // plus the updated section order in the right order.
    await page.locator('.btn-save').click()
    await expect
      .poll(() => savedBody?.changes.map((c) => c.action))
      .toEqual(['add-section', 'set-section'])
    expect(savedBody!.sectionOrder).toEqual(['Main', 'Foils'])
  })

  test('deleting an empty section is allowed but a non-empty one is blocked', async ({ page }) => {
    await page.locator('.btn-sections').click()

    // Main holds Sol Ring, so its Delete is disabled.
    const mainRow = page.locator('.section-manager-row', { hasText: 'Main' })
    await expect(mainRow.locator('.section-manager-delete')).toBeDisabled()

    // A freshly added, empty section can be deleted.
    await page.locator('.section-manager-input').fill('Temp')
    await page.locator('.section-manager-add-btn').click()
    const tempRow = page.locator('.section-manager-row', { hasText: 'Temp' })
    await expect(tempRow.locator('.section-manager-delete')).toBeEnabled()
    await tempRow.locator('.section-manager-delete').click()
    await expect(page.locator('.section-manager-name', { hasText: 'Temp' })).toHaveCount(0)
    // Add then delete cancel out — no net pending change.
    await expect(page.locator('.changes-badge')).toHaveCount(0)
    // Main is still present and still blocked from deletion.
    await expect(mainRow.locator('.section-manager-delete')).toBeDisabled()
  })

  test('rejects a duplicate section name case-insensitively, highlighting the clash', async ({
    page,
  }) => {
    await page.locator('.btn-sections').click()

    // Typing an existing section name in any case marks the input invalid, surfaces an error,
    // highlights the clashing row, and disables the Add button.
    await page.locator('.section-manager-input').fill('main')
    const addBtn = page.locator('.section-manager-add-btn')
    await expect(addBtn).toBeDisabled()
    await expect(page.locator('.section-manager-input.form-input--invalid')).toBeVisible()
    await expect(page.locator('.section-manager .form-error')).toContainText('already exists')
    await expect(page.locator('.section-manager-row--clash', { hasText: 'Main' })).toBeVisible()

    // A free name clears the invalid state and enables Add.
    await page.locator('.section-manager-input').fill('Sideboard')
    await expect(addBtn).toBeEnabled()
    await expect(page.locator('.section-manager-input.form-input--invalid')).toHaveCount(0)
    await expect(page.locator('.section-manager .form-error')).toHaveCount(0)
  })

  test('the "New section…" context action opens a styled prompt (not a native one) and moves the card', async ({
    page,
  }) => {
    const card = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
    await card.locator('.edit-btn-context').click()
    await page.locator('.card-context-menu-item', { hasText: 'Move to section…' }).click()
    await page.locator('.move-picker-item', { hasText: 'New section' }).click()

    // A styled in-app dialog (site dialog chrome), not the browser's native window.prompt.
    const prompt = page.locator('dialog.discard-dialog-native .confirm-dialog.text-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('h3')).toHaveText('Move to new section')

    // A duplicate (case-insensitive) of the existing Main section is rejected.
    await page.locator('#text-prompt-input').fill('main')
    await expect(prompt.locator('.form-error')).toContainText('already exists')
    await expect(prompt.locator('button', { hasText: 'Move' })).toBeDisabled()

    // A fresh name moves the card: one add-section + one set-section change.
    await page.locator('#text-prompt-input').fill('Foils')
    await prompt.locator('button', { hasText: 'Move' }).click()
    await expect(prompt).toBeHidden()
    await expect(page.locator('.changes-badge')).toHaveText('2')
  })

  test('the section "Rename" action opens a styled prompt seeded with the current name', async ({
    page,
  }) => {
    await page.locator('.btn-sections').click()
    await page
      .locator('.section-manager-row', { hasText: 'Main' })
      .locator('.section-manager-rename')
      .click()

    const prompt = page.locator('dialog.discard-dialog-native .confirm-dialog.text-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('h3')).toHaveText('Rename section')
    await expect(page.locator('#text-prompt-input')).toHaveValue('Main')
  })
})
