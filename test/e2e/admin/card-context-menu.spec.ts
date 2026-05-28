import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { openListEditor } from '../helpers/editor-nav'

const CARD = {
  id: 'x',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '2.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'c21',
  set_name: 'Commander 2021',
  collector_number: '167',
  rarity: 'uncommon',
  color_identity: [],
}

// 30 sections → a tall "Move to section" list, so the menu exceeds the space below the anchor.
// Regression guard: the menu previously used a fixed height estimate and ran off the bottom of
// the screen instead of clamping/scrolling so every option stays reachable.
const SECTIONS = Array.from({ length: 30 }, (_, i) => `Section ${i + 1}`)

test('tall card context menu stays within the viewport', async ({ page }) => {
  await loginAsAdmin(page)
  await page.route('**/api/collections', async (r) => {
    if (r.request().method() === 'GET')
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ collections: [{ slug: 'm', name: 'M' }] }),
      })
    else await r.continue()
  })
  await page.route('**/api/collection/m', async (r) => {
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        slug: 'm',
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
        sectionOrder: ['Main', ...SECTIONS],
        cards: { 'c21:167': CARD, 'Sol Ring': CARD },
        printings: { 'Sol Ring': [CARD] },
        symbolMap: {},
        contentHash: 'h',
      }),
    })
  })

  await openListEditor(page, 'collection')
  await page.locator('#collection-select').selectOption('m')
  const card = page.locator('.card-item').filter({ hasText: 'Sol Ring' }).first()
  await card.waitFor({ state: 'visible', timeout: 15000 })
  await card.locator('.edit-btn-context').click()

  const menu = page.locator('.card-context-menu')
  await expect(menu).toBeVisible()

  const box = await menu.boundingBox()
  const viewportH = await page.evaluate(() => window.innerHeight)
  const viewportW = await page.evaluate(() => window.innerWidth)
  expect(box).not.toBeNull()
  // The whole menu must be on-screen (a couple px tolerance for borders/rounding).
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportH + 1)
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportW + 1)
  // And it must be taller-than-fits → scrollable, so every option is reachable.
  const overflowY = await menu.evaluate((el) => getComputedStyle(el).overflowY)
  expect(overflowY).toBe('auto')
})
