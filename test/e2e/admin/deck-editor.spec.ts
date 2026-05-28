import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { disableSearchDebounce } from '../helpers/search-modal'

test.describe('Deck Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    // Register before any navigation so the override applies to the first load.
    await disableSearchDebounce(page)
    await loginAsAdmin(page)
    await openListEditor(page, 'deck')
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
    await select.selectOption(value)
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

    test('undo button is disabled when no changes exist', async ({ page }) => {
      const undoBtn = page.locator('.btn-undo')
      await expect(undoBtn).toBeVisible({ timeout: 5_000 })
      await expect(undoBtn).toBeDisabled()
    })

    test('undo reverses the last change', async ({ page }) => {
      // Unset Sol Ring as commander to create a change
      const commanderCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await expect(commanderCard).toBeVisible({ timeout: 10_000 })
      await commanderCard.locator('.edit-btn-context').click()
      await page.locator('.card-context-menu button', { hasText: 'Unset as Commander' }).click()

      // Changes badge should appear
      await expect(page.locator('.changes-badge')).toBeVisible({ timeout: 5_000 })

      // Undo button should be enabled
      const undoBtn = page.locator('.btn-undo')
      await expect(undoBtn).toBeEnabled()

      // Click undo
      await undoBtn.click()

      // Changes badge should be gone
      await expect(page.locator('.changes-badge')).toHaveCount(0)

      // Undo button should be disabled again
      await expect(undoBtn).toBeDisabled()

      // Sol Ring should be back in commander section
      const restoredCard = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
      await restoredCard.locator('.edit-btn-context').click()
      const menu = page.locator('.card-context-menu')
      await expect(menu.locator('button', { hasText: 'Unset as Commander' })).toBeVisible()
    })
  })

  test.describe('add card dialog state reset', () => {
    const MOCK_BOLT_CARD = {
      id: 'bolt-id',
      name: 'Lightning Bolt',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
      prices: {
        usd: '1.00',
        usd_foil: null,
        usd_etched: null,
        eur: '0.80',
        eur_foil: null,
        tix: null,
      },
      finishes: ['nonfoil'],
      games: ['paper'],
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      rarity: 'common',
      color_identity: ['R'],
    }

    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page)

      await page.route('**/api/decks', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ decks: [{ slug: 'test-modal-deck', name: 'Test Modal Deck' }] }),
          })
        } else {
          await route.continue()
        }
      })

      await page.route('**/api/deck/test-modal-deck', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            slug: 'test-modal-deck',
            deck: {
              name: 'Test Modal Deck',
              sections: [
                {
                  name: 'Main',
                  cards: [
                    { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
                  ],
                },
              ],
            },
            cards: { 'Lightning Bolt': MOCK_BOLT_CARD },
            printings: { 'Lightning Bolt': [MOCK_BOLT_CARD] },
            lowestPriceCards: { 'Lightning Bolt': MOCK_BOLT_CARD },
            lowestPriceCardsEur: { 'Lightning Bolt': MOCK_BOLT_CARD },
            lowestPriceCardsTix: {},
            symbolMap: {},
            frontMatter: {},
          }),
        })
      })

      await page.route('**/api/autocomplete*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, names: ['Lightning Bolt', 'Lightning Helix'] }),
        })
      })

      await page.route('**/api/card-printings*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, printings: [MOCK_BOLT_CARD] }),
        })
      })

      await openListEditor(page, 'deck')

      const select = page.locator('select').first()
      await page.waitForFunction(
        () => (document.querySelector('select')?.options.length ?? 0) > 1,
        {
          timeout: 10_000,
        },
      )
      await select.selectOption('test-modal-deck')
      await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    })

    test('resets to search step when reopened after navigating to printing step', async ({
      page,
    }) => {
      // Open the add card modal
      await page.locator('.btn-add').click()
      const searchInput = page.locator('.search-modal input[type="text"]')
      await expect(searchInput).toBeVisible({ timeout: 5_000 })

      // The dialog shows quick-switch-style keyboard hints and no overlapping
      // close button (dismissal is via Esc / backdrop).
      const footer = page.locator('.search-modal-footer')
      await expect(footer).toContainText('navigate')
      await expect(footer).toContainText('close')
      await expect(page.locator('.search-modal .modal-close-btn-abs')).toHaveCount(0)

      // Type to trigger autocomplete (debounced 1s)
      await searchInput.fill('Lightning')
      const boltResult = page.locator('.search-result-item', { hasText: 'Lightning Bolt' })
      await expect(boltResult).toBeVisible({ timeout: 5_000 })

      // Click Lightning Bolt → advances to printing step
      await boltResult.click()
      await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
        timeout: 5_000,
      })
      await expect(searchInput).toHaveCount(0)

      // Close the modal via Escape
      await page.keyboard.press('Escape')
      await expect(page.locator('.modal-heading-flex')).toHaveCount(0, { timeout: 3_000 })

      // Reopen the modal — must start back on the search step, not the printing step
      await page.locator('.btn-add').click()
      await expect(searchInput).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('.modal-heading-flex')).toHaveCount(0)
    })
  })
})
