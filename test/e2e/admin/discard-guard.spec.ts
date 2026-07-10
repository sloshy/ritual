import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'

/** Synthetic Lightning Bolt printing shared across the mocked decks. */
const BOLT = makeMockScryfallCard({
  id: 'bolt-lea',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  prices: { usd: '1.00', eur: '0.80' },
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  color_identity: ['R'],
})

/** Build a one-card deck payload for the data endpoint. */
function deckPayload(slug: string, name: string) {
  return {
    success: true,
    slug,
    contentHash: `hash-${slug}`,
    deck: {
      name,
      sections: [
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          ],
        },
      ],
    },
    cards: { 'Lightning Bolt': BOLT },
    printings: { 'Lightning Bolt': [BOLT] },
    lowestPriceCards: { 'Lightning Bolt': BOLT },
    lowestPriceCardsEur: { 'Lightning Bolt': BOLT },
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: {},
  }
}

const DISCARD_DIALOG = '.modal-shell[open]'

test.describe('Editor — discard guard on navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/decks',
      {
        decks: [
          { slug: 'deck-a', name: 'Deck A' },
          { slug: 'deck-b', name: 'Deck B' },
        ],
      },
      { method: 'GET' },
    )
    await fulfillJson(page, '**/api/deck/deck-a', deckPayload('deck-a', 'Deck A'))
    await fulfillJson(page, '**/api/deck/deck-b', deckPayload('deck-b', 'Deck B'))
    // Collections list, for the tab-switch case.
    await fulfillJson(page, '**/api/collections', { collections: [] }, { method: 'GET' })
    // Logout, for the logout-guard case.
    await fulfillJson(page, '**/api/logout', {})

    await openListEditor(page, 'deck')
    const select = page.locator('#deck-select')
    await page.waitForFunction(
      () => (document.querySelector('#deck-select') as HTMLSelectElement)?.options.length > 1,
      { timeout: 10_000 },
    )
    await select.selectOption('deck-a')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })
  })

  /** Increment Lightning Bolt to create one unsaved change. */
  const makeChange = async (page: import('@playwright/test').Page) => {
    await page
      .locator('.card-item')
      .filter({ hasText: 'Lightning Bolt' })
      .first()
      .locator('.edit-btn-increment')
      .click()
    await expect(page.locator('.changes-badge')).toHaveText('1')
  }

  test('switching decks with no changes loads immediately, no prompt', async ({ page }) => {
    await page.locator('#deck-select').selectOption('deck-b')
    await expect(page.locator(DISCARD_DIALOG)).toHaveCount(0)
    await expect(page.locator('#deck-select')).toHaveValue('deck-b')
  })

  test('cancelling the discard prompt keeps the current deck and its changes', async ({ page }) => {
    await makeChange(page)
    await page.locator('#deck-select').selectOption('deck-b')

    const dialog = page.locator(DISCARD_DIALOG)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Discard 1 change?')

    await dialog.locator('button', { hasText: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    // Selection reverts and the pending change survives.
    await expect(page.locator('#deck-select')).toHaveValue('deck-a')
    await expect(page.locator('.changes-badge')).toHaveText('1')
  })

  test('confirming the discard switches decks and drops changes', async ({ page }) => {
    await makeChange(page)
    await page.locator('#deck-select').selectOption('deck-b')

    const dialog = page.locator(DISCARD_DIALOG)
    await expect(dialog).toBeVisible()
    await dialog.locator('.btn-danger', { hasText: 'Yes, discard' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.locator('#deck-select')).toHaveValue('deck-b')
    await expect(page.locator('.changes-badge')).toHaveCount(0)
  })

  test('switching type tabs with unsaved changes prompts, then switches on confirm', async ({
    page,
  }) => {
    await makeChange(page)
    await page.locator('.list-type-tab:has-text("Collections")').click()

    const dialog = page.locator(DISCARD_DIALOG)
    await expect(dialog).toBeVisible()

    // Cancel keeps the deck editor mounted.
    await dialog.locator('button', { hasText: 'Cancel' }).click()
    await expect(page.locator('#deck-select')).toBeVisible()

    // Confirm swaps to the collection editor, dropping the change.
    await page.locator('.list-type-tab:has-text("Collections")').click()
    await page.locator(DISCARD_DIALOG).locator('.btn-danger').click()
    await expect(page.locator('#collection-select')).toBeVisible()
    await expect(page.locator('#deck-select')).toHaveCount(0)
  })

  test('sidebar navigation with unsaved changes prompts, then leaves on confirm', async ({
    page,
  }) => {
    await makeChange(page)
    await page.locator('.admin-nav-item:has-text("Dashboard")').click()

    const dialog = page.locator(DISCARD_DIALOG)
    await expect(dialog).toBeVisible()

    // Cancel stays on the editor page.
    await dialog.locator('button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.section-heading')).toContainText('Edit Lists')

    // Confirm leaves for the dashboard.
    await page.locator('.admin-nav-item:has-text("Dashboard")').click()
    await page.locator(DISCARD_DIALOG).locator('.btn-danger').click()
    await expect(page.locator('.section-heading:has-text("Edit Lists")')).toHaveCount(0)
    await expect(page.locator('#deck-select')).toHaveCount(0)
  })

  test('logout with unsaved changes prompts, then logs out on confirm', async ({ page }) => {
    await makeChange(page)
    const logout = page.locator('.admin-header button:has-text("Logout")')
    await logout.click()

    const dialog = page.locator(DISCARD_DIALOG)
    await expect(dialog).toBeVisible()

    // Cancel stays logged in on the editor page.
    await dialog.locator('button', { hasText: 'Cancel' }).click()
    await expect(page.locator('#deck-select')).toBeVisible()

    // Confirm tears down the authenticated layout.
    await logout.click()
    await page.locator(DISCARD_DIALOG).locator('.btn-danger').click()
    await expect(page.locator('.admin-nav-item')).toHaveCount(0)
  })

  test('beforeunload is guarded only while changes are pending', async ({ page }) => {
    const dispatchUnload = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })

    // Clean editor: the unload handler must not block.
    expect(await dispatchUnload()).toBe(false)

    // With a pending change the handler cancels the event (native prompt shows).
    await makeChange(page)
    expect(await dispatchUnload()).toBe(true)
  })
})
