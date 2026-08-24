import { test, expect, type Page } from '@playwright/test'
import type {
  CollectionFullLoadResult,
  DeckFullLoadResult,
} from '../../../src/admin/api/load-results'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor, selectList } from '../helpers/editor-nav'
import {
  SYNTHETIC_SWAP_COLLECTION_SLUG,
  SYNTHETIC_SWAP_DECK_SLUG,
} from '../helpers/synthetic-workspace'
import {
  candidateRows,
  cardRow,
  footerButton,
  goNext,
  takeOneButton,
  wizardOf,
} from '../helpers/swap-ui'

/**
 * The Swap Printings wizard in the admin deck editor, run against the real
 * server: the synthetic `test-swap-deck` pins Sol Ring C21:263 and the
 * synthetic `test-swap-binder` holds a LEA:270 copy. Swapping and saving commits
 * both sides — the deck line re-pins, the binder loses the copy it gave and
 * gains the one it displaced — which is read back through the load API.
 */

// The save rewrites the two seeded files, and the workspace is created once per
// run — a retry would start from the swapped state and fail on the baseline
// below for the wrong reason. Run once.
test.describe.configure({ retries: 0 })

/** `name|set:cn` for every card line of the deck's sections, in file order. */
async function deckLines(page: Page): Promise<string[]> {
  const res = await page.request.get(`/api/deck/${SYNTHETIC_SWAP_DECK_SLUG}`)
  const body = (await res.json()) as DeckFullLoadResult
  return body.deck.sections.flatMap((section) =>
    section.cards.map((card) => `${card.name}|${card.set ?? ''}:${card.collectorNumber ?? ''}`),
  )
}

/** `name|set:cn` for every entry of the binder, in file order. */
async function binderLines(page: Page): Promise<string[]> {
  const res = await page.request.get(`/api/collection/${SYNTHETIC_SWAP_COLLECTION_SLUG}`)
  const body = (await res.json()) as CollectionFullLoadResult
  return body.entries.map((entry) => `${entry.name}|${entry.set}:${entry.collectorNumber}`)
}

test.describe('Swap Printings (admin deck editor)', () => {
  test('swapping for the binder copy and saving updates both files', async ({ page }) => {
    await gotoAdminDashboard(page)
    await openListEditor(page, 'deck')
    await selectList(page, 'deck', SYNTHETIC_SWAP_DECK_SLUG)
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })

    // Baseline, so the assertions below prove a transition rather than a fixture.
    expect(await deckLines(page)).toEqual(['Sol Ring|c21:263', 'Counterspell|:'])
    expect(await binderLines(page)).toEqual(['Sol Ring|lea:270', 'Dark Ritual|lea:98'])

    await page.locator('.editor-action-bar .btn-swap-printings').click()
    const wizard = wizardOf(page)
    await expect(wizard).toBeVisible()

    // Cards (both pre-checked; the name-only Counterspell is left out of this
    // run so the picker covers Sol Ring alone) → Sources → Mode (manual) → Pick.
    await expect(cardRow(wizard, 'Sol Ring').locator('input')).toBeChecked()
    const counterspellRow = cardRow(wizard, 'Counterspell')
    await expect(counterspellRow).toContainText('no printing set')
    await counterspellRow.locator('input').uncheck()
    await goNext(wizard, 'Sources')
    await goNext(wizard, 'Mode')
    await goNext(wizard, 'Pick')
    await expect(wizard).toContainText('Pick printings for Sol Ring')
    const binderRow = candidateRows(wizard)
      .filter({ hasText: 'Test Swap Binder' })
      .filter({ hasText: 'LEA:270' })
    await takeOneButton(binderRow).click()
    await goNext(wizard, 'Summary')

    // Summary → Apply: two pending moves in the deck's change stack.
    await expect(wizard).toContainText('Taken from Test Swap Binder')
    await expect(wizard).toContainText('Sent to Test Swap Binder')
    await footerButton(wizard, 'Apply').click()
    await expect(wizard).toBeHidden()
    await expect(page.locator('.changes-badge')).toHaveText('2')

    // Save commits the deck and mirrors the moves into the binder: the deck
    // pins LEA:270, the binder lost that copy and gained the displaced C21:263.
    // Compared order-insensitively — an arriving line lands wherever the list
    // writer appends it, and where is not what this asserts.
    await page.locator('.btn-save').click()
    await expect(page.locator('.changes-badge')).toHaveCount(0)
    await expect
      .poll(async () => (await deckLines(page)).sort())
      .toEqual(['Counterspell|:', 'Sol Ring|lea:270'].sort())
    await expect
      .poll(async () => (await binderLines(page)).sort())
      .toEqual(['Dark Ritual|lea:98', 'Sol Ring|c21:263'].sort())
  })
})
