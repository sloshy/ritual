import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'
import { disableSearchDebounce } from '../helpers/search-modal'

test.describe('Deck Editor Page', () => {
  test.beforeEach(async ({ page }) => {
    // Register before any navigation so the override applies to the first load.
    await disableSearchDebounce(page)
    await gotoAdminDashboard(page)
    await openListEditor(page, 'deck')
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
    const MOCK_BOLT_CARD = makeMockScryfallCard({
      id: 'bolt-id',
      name: 'Lightning Bolt',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      prices: { usd: '1.00', eur: '0.80' },
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      color_identity: ['R'],
      // A resolvable image URL, without which the search modal has no preview to show.
      image_uris: { normal: 'https://example.invalid/bolt.png' },
    })

    test.beforeEach(async ({ page }) => {
      await gotoAdminDashboard(page)

      await fulfillJson(
        page,
        '**/api/decks',
        { decks: [{ slug: 'test-modal-deck', name: 'Test Modal Deck' }] },
        { method: 'GET' },
      )

      await fulfillJson(page, '**/api/deck/test-modal-deck', {
        success: true,
        slug: 'test-modal-deck',
        deck: {
          name: 'Test Modal Deck',
          sections: [
            {
              name: 'Main',
              cards: [{ quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
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
      })

      await fulfillJson(page, '**/api/autocomplete*', {
        success: true,
        names: ['Lightning Bolt', 'Lightning Helix'],
      })

      await fulfillJson(page, '**/api/card-printings*', {
        success: true,
        printings: [MOCK_BOLT_CARD],
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

    test('highlighting a search result shows a positioned card preview', async ({ page }) => {
      await page.locator('.btn-add').click()
      const searchInput = page.locator('.search-modal input[type="text"]')
      await expect(searchInput).toBeVisible({ timeout: 5_000 })

      await searchInput.fill('Lightning')
      const boltResult = page.locator('.search-result-item', { hasText: 'Lightning Bolt' })
      await expect(boltResult).toBeVisible({ timeout: 5_000 })
      await boltResult.hover()

      // The preview must be positioned next to the modal, not left at its
      // initial `display: none` (its style is computed once the panel exists).
      const preview = page.locator('.search-card-preview')
      await expect(preview).toBeVisible({ timeout: 5_000 })
      await expect(preview).toHaveAttribute('style', /left: \d+px; top: \d+px;/)

      // Leaving the search step drops the preview entirely.
      await boltResult.click()
      await expect(page.locator('.modal-heading-flex')).toContainText('Select a printing', {
        timeout: 5_000,
      })
      await expect(preview).toHaveCount(0)
    })
  })
})
