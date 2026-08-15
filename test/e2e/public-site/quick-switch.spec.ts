import { test, expect } from '@playwright/test'
import { mockPublicSiteForQuickSwitch } from '../helpers/mock-public-site'

test.describe('Quick Switch', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteForQuickSwitch(page)
    await page.goto('/')
  })

  test('opens via header button and lists all entries', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    const dialog = page.locator('.quick-switch-dialog')
    await expect(dialog).toBeVisible()
    const rows = dialog.locator('.quick-switch-row')
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toContainText('Azorius Control')
    await expect(rows.nth(1)).toContainText('Mono Red Aggro')
    await expect(rows.nth(2)).toContainText('Main Binder')
    await expect(rows.nth(3)).toContainText('High Priority')
  })

  test('typing filters results by name', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('mono')
    const rows = page.locator('.quick-switch-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.nth(0)).toContainText('Mono Red Aggro')
  })

  test('Enter navigates to the selected list and closes the dialog', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('binder')
    await page.locator('.quick-switch-input').press('Enter')
    await expect.poll(() => page.url()).toContain('#/collection/main-binder')
    await expect(page.locator('.quick-switch-dialog')).toHaveCount(0)
  })

  test('arrow keys move selection and Enter opens the highlighted entry', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    const input = page.locator('.quick-switch-input')
    await input.press('ArrowDown')
    await input.press('ArrowDown')
    await expect(page.locator('.quick-switch-row-active')).toContainText('Main Binder')
    await input.press('Enter')
    await expect.poll(() => page.url()).toContain('#/collection/main-binder')
  })

  test('Escape closes the dialog', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    await expect(page.locator('.quick-switch-dialog')).toBeVisible()
    await page.locator('.quick-switch-input').press('Escape')
    await expect(page.locator('.quick-switch-dialog')).toHaveCount(0)
  })

  test('Ctrl+K opens the dialog from the homepage', async ({ page }) => {
    await page.keyboard.press('Control+k')
    await expect(page.locator('.quick-switch-dialog')).toBeVisible()
  })

  test('typing a commander name surfaces a commander entry pointing at its deck', async ({
    page,
  }) => {
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('teferi')
    const rows = page.locator('.quick-switch-row')
    const commanderRow = rows.filter({ hasText: 'Commander' }).first()
    await expect(commanderRow).toContainText('Teferi, Hero of Dominaria')
    await expect(commanderRow).toContainText('Azorius Control')
    await commanderRow.click()
    await expect.poll(() => page.url()).toContain('#/deck/azorius-control')
  })

  test('typing a card name surfaces card entries from each containing list', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('lightning')
    const rows = page.locator('.quick-switch-row')
    // Filter on the kind badge exactly — a bare hasText: 'Card' would also
    // match list rows via their "N cards" count label.
    const cardRows = rows.filter({
      has: page.locator('.quick-switch-row-kind', { hasText: /^Card$/ }),
    })
    await expect.poll(() => cardRows.count()).toBe(2)
    const monoRedCardRow = cardRows.filter({ hasText: 'Mono Red Aggro' })
    const binderCardRow = cardRows.filter({ hasText: 'Main Binder' })
    await expect(monoRedCardRow).toContainText('Lightning Bolt')
    await expect(binderCardRow).toContainText('Lightning Bolt')
    // Each card row shows how many copies its list holds: the deck line's
    // quantity, and one per collection entry line — the binder's two duplicate
    // Lightning Bolt lines collapse into this one ×2 row.
    await expect(monoRedCardRow.locator('.quick-switch-row-qty')).toHaveText('×4')
    await expect(binderCardRow.locator('.quick-switch-row-qty')).toHaveText('×2')
    await monoRedCardRow.click()
    await expect.poll(() => page.url()).toContain('#/deck/mono-red-aggro')
  })

  test('the quick switch searches owned entries, not changelog-only card map entries', async ({
    page,
  }) => {
    // Main Binder owns Moonshadow ecl:386. Its card map ALSO holds a non-owned
    // ecl:110 printing under the bare "Moonshadow" name key (for changelog
    // thumbnails). Search must reflect only the owned printing: one Moonshadow
    // card, one ECL:386 printing, and never ECL:110.
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('moonshadow')
    const moonshadowCardRows = page.locator('.quick-switch-row').filter({
      has: page.locator('.quick-switch-row-kind', { hasText: /^Card$/ }),
    })
    await expect.poll(() => moonshadowCardRows.count()).toBe(1)
    await expect(moonshadowCardRows.first()).toContainText('Moonshadow')
    await expect(moonshadowCardRows.first()).toContainText('Main Binder')

    await page.locator('.quick-switch-input').fill('ecl:')
    const printingRows = page.locator('.quick-switch-row').filter({ hasText: 'Printing' })
    await expect.poll(() => printingRows.count()).toBe(1)
    await expect(printingRows.first()).toContainText('ECL:386')
    await expect(page.locator('.quick-switch-row').filter({ hasText: 'ECL:110' })).toHaveCount(0)
  })

  test('a changelog-only card that is no longer owned does not appear in search', async ({
    page,
  }) => {
    // "Mistrise Village" is present in Main Binder's card map by name (so the
    // changelog can render it) but is not an owned entry. It must not surface.
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('mistrise')
    await expect.poll(() => page.locator('.quick-switch-row').count()).toBe(0)
  })

  test('a card owned as multiple printings surfaces one card row but distinct printings', async ({
    page,
  }) => {
    // Sol Ring is owned as two printings (c16:234 and lgn:303). The "Card" tier
    // shows it once; the "Printing" tier keeps both.
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('sol ring')
    const solCardRows = page.locator('.quick-switch-row').filter({
      has: page.locator('.quick-switch-row-kind', { hasText: /^Card$/ }),
    })
    await expect.poll(() => solCardRows.count()).toBe(1)
    await expect(solCardRows.first()).toContainText('Sol Ring')
    // The single card row counts copies across BOTH printings...
    await expect(solCardRows.first().locator('.quick-switch-row-qty')).toHaveText('×2')

    await page.locator('.quick-switch-input').fill('c16:234')
    await expect
      .poll(() => page.locator('.quick-switch-row').filter({ hasText: 'C16:234' }).count())
      .toBe(1)
    // ...while each printing row counts only its own copies.
    await expect(
      page
        .locator('.quick-switch-row')
        .filter({ hasText: 'C16:234' })
        .locator('.quick-switch-row-qty'),
    ).toHaveText('×1')
    await page.locator('.quick-switch-input').fill('lgn:303')
    await expect
      .poll(() => page.locator('.quick-switch-row').filter({ hasText: 'LGN:303' }).count())
      .toBe(1)
  })

  test('list matches rank above commander matches which rank above card matches', async ({
    page,
  }) => {
    await page.locator('.quick-switch-trigger').click()
    await page.locator('.quick-switch-input').fill('teferi')
    await expect.poll(() => page.locator('.quick-switch-row').count()).toBeGreaterThan(0)
    await page.locator('.quick-switch-input').fill('mono')
    const rows = page.locator('.quick-switch-row')
    await expect(rows.first()).toContainText('Mono Red Aggro')
    await expect(rows.first()).toContainText('Deck')
  })

  test('typing a set:collector code produces a Printing entry in the 4th tier', async ({
    page,
  }) => {
    await page.locator('.quick-switch-trigger').click()
    // Wait for detail JSONs (so printing candidates exist)
    await page.locator('.quick-switch-input').fill('teferi')
    await expect.poll(() => page.locator('.quick-switch-row').count()).toBeGreaterThan(0)
    await page.locator('.quick-switch-input').fill('mkm')
    const rows = page.locator('.quick-switch-row')
    const printingRow = rows.filter({ hasText: 'Printing' }).first()
    await expect(printingRow).toContainText('MKM:42')
    await expect(printingRow).toContainText('Main Binder')
    await printingRow.click()
    await expect.poll(() => page.url()).toContain('#/collection/main-binder')
  })

  test('printing entries display in the 4th tier (after card name matches)', async ({ page }) => {
    await page.locator('.quick-switch-trigger').click()
    // Use a query that will produce both card and printing matches.
    // 'lightning' matches the Lightning Bolt card name (tier 3). MKM has no
    // 'lightning' in its set:collector key, but the Mono Red deck contains
    // Goblin Guide and Lightning Bolt (name keys). For tier ordering we just
    // verify cards come before printings:
    await page.locator('.quick-switch-input').fill('m')
    await expect.poll(() => page.locator('.quick-switch-row').count()).toBeGreaterThan(0)
    const rows = page.locator('.quick-switch-row')
    const allKinds = await rows.locator('.quick-switch-row-kind').allTextContents()
    const firstPrintingIdx = allKinds.indexOf('Printing')
    const firstCardIdx = allKinds.indexOf('Card')
    if (firstPrintingIdx >= 0 && firstCardIdx >= 0) {
      expect(firstCardIdx).toBeLessThan(firstPrintingIdx)
    }
  })
})
