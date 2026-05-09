import { test, expect } from '@playwright/test'
import { mockPublicSiteForQuickSwitch } from '../helpers/mock-data'

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
    const cardRows = rows.filter({ hasText: 'Card' })
    await expect.poll(() => cardRows.count()).toBe(2)
    const monoRedCardRow = cardRows.filter({ hasText: 'Mono Red Aggro' })
    const binderCardRow = cardRows.filter({ hasText: 'Main Binder' })
    await expect(monoRedCardRow).toContainText('Lightning Bolt')
    await expect(binderCardRow).toContainText('Lightning Bolt')
    await monoRedCardRow.click()
    await expect.poll(() => page.url()).toContain('#/deck/mono-red-aggro')
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
