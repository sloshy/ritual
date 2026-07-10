import { test, expect } from '@playwright/test'
import type { ScryfallCard } from '../../../src/types'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'
import { fulfillJson } from '../helpers/fulfill'
import { makeMockScryfallCard } from '../helpers/mock-cards'

// A deck large enough to make the editor page scroll, so the filter toolbar
// reaches its pinned (`is-stuck`) state.
const CARD_COUNT = 50

function makeCard(i: number): ScryfallCard {
  return makeMockScryfallCard({
    id: `card-${i}`,
    name: `Test Card ${i}`,
    cmc: 1,
    type_line: 'Creature — Test',
    oracle_text: 'A synthetic test card.',
    prices: { usd: '1.00', eur: '0.80' },
    set: 'fdn',
    set_name: 'Foundations',
    collector_number: String(100 + i),
    color_identity: ['G'],
  })
}

const CARDS = Array.from({ length: CARD_COUNT }, (_, i) => makeCard(i + 1))

function mapByName<T>(value: (c: ScryfallCard) => T): Record<string, T> {
  return Object.fromEntries(CARDS.map((c) => [c.name, value(c)]))
}

test.describe('Admin Editor — pinned toolbar layout', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)

    await fulfillJson(
      page,
      '**/api/decks',
      { decks: [{ slug: 'test-big-deck', name: 'Big Deck' }] },
      { method: 'GET' },
    )

    await fulfillJson(page, '**/api/deck/test-big-deck', {
      success: true,
      slug: 'test-big-deck',
      deck: {
        name: 'Big Deck',
        sections: [
          {
            name: 'Main',
            cards: CARDS.map((c) => ({
              quantity: 1,
              name: c.name,
              set: c.set,
              collectorNumber: c.collector_number,
            })),
          },
        ],
      },
      cards: mapByName((c) => c),
      printings: mapByName((c) => [c]),
      lowestPriceCards: mapByName((c) => c),
      lowestPriceCardsEur: mapByName((c) => c),
      lowestPriceCardsTix: {},
      symbolMap: {},
      frontMatter: {},
    })
  })

  test('pinned filter toolbar stays within the editor area and never covers the sidebar', async ({
    page,
  }) => {
    // Wide enough for the desktop sidebar (>=768px), short enough to force scroll.
    await page.setViewportSize({ width: 1280, height: 700 })

    await openListEditor(page, 'deck')
    const select = page.locator('.deck-selector')
    await select.waitFor({ state: 'visible' })
    await page.waitForFunction(
      () => (document.querySelector('.deck-selector')?.children.length ?? 0) > 1,
      { timeout: 10_000 },
    )
    await select.selectOption('test-big-deck')
    await page.locator('.card-item').first().waitFor({ state: 'visible', timeout: 15_000 })

    const toolbar = page.locator('.toolbar').first()
    const sidebar = page.locator('.admin-sidebar-panel')
    await expect(sidebar).toBeVisible()

    // Scroll down so the toolbar pins to the top and the full-bleed styling kicks in.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(toolbar).toHaveClass(/is-stuck/, { timeout: 5_000 })

    const toolbarBox = await toolbar.boundingBox()
    const sidebarBox = await sidebar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()

    // The buggy full-bleed (margin: 0 calc(50% - 50vw)) assumes a
    // viewport-centered container; in the sidebar-offset editor it stretches the
    // pinned toolbar wider than the viewport, producing a horizontal scrollbar.
    // The fix bounds it to the editor area, so the page must not scroll sideways.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

    // ...and the pinned toolbar must never start left of the sidebar's right edge.
    const sidebarRight = sidebarBox!.x + sidebarBox!.width
    expect(toolbarBox!.x).toBeGreaterThanOrEqual(sidebarRight - 1)
  })
})
