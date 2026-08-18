import { test, expect, type Page, type Route } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

const MOCK_SOL_RING = makeMockScryfallCard({
  id: 'sol-ring-id',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '2.00' },
  set: 'c21',
  set_name: 'Commander 2021',
  collector_number: '167',
  rarity: 'uncommon',
})

const MOCK_STATIC_ORB = makeMockScryfallCard({
  id: 'static-orb-id',
  name: 'Static Orb',
  cmc: 3,
  type_line: 'Artifact',
  prices: { usd: '5.00' },
  set: 'tmp',
  set_name: 'Tempest',
  collector_number: '319',
  rarity: 'rare',
  image_uris: { normal: 'https://img.example/static-orb.jpg' },
})

test.describe('Collection Editor sections', () => {
  let savedBody: { changes: { action: string }[]; sectionOrder: string[] } | null

  test.beforeEach(async ({ page }) => {
    savedBody = null
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/collections',
      { collections: [{ slug: 'test-sections', name: 'Test Sections' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/collection/test-sections', {
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
    })

    await fulfillJson(page, '**/api/collection/test-sections/save', (route: Route) => {
      savedBody = JSON.parse(route.request().postData() ?? '{}')
      return { success: true, message: 'Saved', contentHash: 'hash-2' }
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
    const prompt = page.locator('dialog.modal-shell .modal-panel.text-prompt')
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

    const prompt = page.locator('dialog.modal-shell .modal-panel.text-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('h3')).toHaveText('Rename section')
    await expect(page.locator('#text-prompt-input')).toHaveValue('Main')
  })

  /** Stage a pending change (which one is irrelevant) so Save has something to send. */
  async function stageASectionAdd(page: Page): Promise<void> {
    await page.locator('.btn-sections').click()
    await page.locator('.section-manager-input').fill('Foils')
    await page.locator('.section-manager-add-btn').click()
    await page.keyboard.press('Escape')
  }

  test('a save reports through a viewport-pinned toast that clears itself', async ({ page }) => {
    await stageASectionAdd(page)
    await page.locator('.btn-save').click()

    const toast = page.locator('.toast-stack .alert-success')
    await expect(toast).toHaveText('Changes saved successfully')
    // Fixed and outside <main>: the banner it replaces scrolled away with the
    // list, which is precisely when a save result needs to be readable.
    const stackPosition = await page
      .locator('.toast-stack')
      .evaluate((el) => getComputedStyle(el).position)
    expect(stackPosition).toBe('fixed')
    await expect(page.locator('main .alert-success')).toHaveCount(0)

    // Five seconds of it, then a fade, then gone — no click required. The
    // mid-flight check is what stops a zero-length window from passing.
    await page.waitForTimeout(3_000)
    await expect(toast).toBeVisible()
    await expect(toast).toHaveCount(0, { timeout: 5_000 })
  })

  test('a failed save toasts the error, and a later save toasts again', async ({ page }) => {
    // Re-registered after the beforeEach route, so this one answers first.
    await fulfillJson(page, '**/api/collection/test-sections/save', {
      success: false,
      error: 'Collection is locked',
    })

    await stageASectionAdd(page)
    await page.locator('.btn-save').click()

    const errorToast = page.locator('.toast-stack .alert-error')
    await expect(errorToast).toHaveText('Collection is locked')
    await expect(errorToast).toHaveCount(0, { timeout: 10_000 })

    // Retrying after it expired must toast the same failure again rather than
    // going silent because the message never changed.
    await page.locator('.btn-save').click()
    await expect(errorToast).toHaveText('Collection is locked')
  })
})

/** One change event as captured from the save request body. */
type SavedChange = {
  action: string
  cardName?: string
  set?: string
  collectorNumber?: string
  finish?: string
  condition?: string
  cardId?: number
}

test.describe('Collection Editor — add card from search', () => {
  let savedBody: { changes: SavedChange[] } | null

  test.beforeEach(async ({ page }) => {
    savedBody = null
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/collections',
      { collections: [{ slug: 'binder', name: 'Binder' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/collection/binder', {
      success: true,
      slug: 'binder',
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
    })

    await fulfillJson(page, '**/api/collection/binder/save', (route: Route) => {
      savedBody = JSON.parse(route.request().postData() ?? '{}')
      return { success: true, message: 'Saved', contentHash: 'hash-2' }
    })

    await fulfillJson(page, '**/api/autocomplete*', { success: true, names: ['Static Orb'] })
    await fulfillJson(page, '**/api/card-printings*', {
      success: true,
      printings: [MOCK_STATIC_ORB],
    })

    await openListEditor(page, 'collection')
    await page.waitForFunction(
      () => (document.querySelector('#collection-select') as HTMLSelectElement)?.options.length > 1,
      { timeout: 10_000 },
    )
    await page.locator('#collection-select').selectOption('binder')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  /**
   * Add Static Orb keyboard-only: search → Enter, printing → Enter, condition →
   * Enter. `copies` above one is dialled in with the quantity ticker's `+` key.
   */
  async function addStaticOrbByKeyboard(page: Page, copies = 1): Promise<void> {
    await page.keyboard.press('Control+Enter')
    const searchInput = page.locator('.search-modal input[type="text"]')
    await expect(searchInput).toBeVisible({ timeout: 5_000 })
    await searchInput.fill('Static Orb')
    await expect(page.locator('.search-result-item', { hasText: 'Static Orb' })).toBeVisible()
    await page.keyboard.press('Enter')

    // Printing step: the single printing starts highlighted; Enter selects it.
    await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
      timeout: 5_000,
    })
    await expect(page.locator('.printing-select-card')).toBeVisible()
    await page.keyboard.press('Enter')

    // Collections always confirm condition; Enter accepts the NM preselection.
    await expect(page.locator('.modal-heading-flex')).toContainText('Set finish & condition', {
      timeout: 5_000,
    })
    for (let i = 1; i < copies; i++) await page.keyboard.press('+')
    await expect(page.locator('#add-card-qty .qty-val')).toHaveText(String(copies))
    await page.keyboard.press('Enter')
    await expect(page.locator('.modal-heading-flex')).toHaveCount(0, { timeout: 5_000 })
  }

  test('a keyboard-only add carries the chosen printing through to the saved change', async ({
    page,
  }) => {
    await addStaticOrbByKeyboard(page)

    // The new tile renders with card data: its art is present, not a blank placeholder.
    const tile = page.locator('.card-item', { hasText: 'Static Orb' })
    await expect(tile).toBeVisible({ timeout: 5_000 })
    await expect(tile.locator('img').first()).toBeVisible()

    // The saved add change names the exact printing picked in the modal.
    await page.locator('.btn-save').click()
    await expect.poll(() => savedBody?.changes.length).toBe(1)
    expect(savedBody!.changes[0]).toMatchObject({
      action: 'add',
      cardName: 'Static Orb',
      set: 'tmp',
      collectorNumber: '319',
      finish: 'nonfoil',
      condition: 'NM',
      cardId: 2,
    })
  })

  test('the quantity ticker adds one entry per copy, each with its own card ID', async ({
    page,
  }) => {
    await addStaticOrbByKeyboard(page, 3)

    // Collections store one entry per copy, so three tiles — not one tile of three.
    await expect(page.locator('.card-item', { hasText: 'Static Orb' })).toHaveCount(3, {
      timeout: 5_000,
    })

    await page.locator('.btn-save').click()
    await expect.poll(() => savedBody?.changes.length).toBe(3)
    expect(savedBody!.changes.map((c) => c.cardId)).toEqual([2, 3, 4])
    for (const change of savedBody!.changes) {
      expect(change).toMatchObject({
        action: 'add',
        cardName: 'Static Orb',
        set: 'tmp',
        collectorNumber: '319',
      })
    }
  })

  test('a card added from search opens the details modal on click', async ({ page }) => {
    await addStaticOrbByKeyboard(page)

    await page.locator('.card-item', { hasText: 'Static Orb' }).locator('img').first().click()
    await expect(page.locator('.card-modal-details')).toBeVisible({ timeout: 5_000 })
  })
})
