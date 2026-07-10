import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  mockPublicSiteCollection,
  mockPublicSiteDeckWithMultipleSections,
  mockPublicSiteWantedList,
} from '../helpers/mock-public-site'

// The page-header export menu (Copy / Download with TXT / MD / CSV) is shared by
// the deck, collection, and wanted-list read views. These cover the end-to-end
// wiring: opening a format dropdown and actually producing the serialized list.
test.describe('Page-header export menu', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  const openFormat = async (
    page: import('@playwright/test').Page,
    trigger: 'Copy' | 'Download',
  ) => {
    await page.locator('.export-menu-control button', { hasText: trigger }).click()
    await expect(page.locator('.selection-menu-panel[role="menu"]')).toBeVisible()
  }

  test('downloads a deck as plain text', async ({ page }) => {
    await mockPublicSiteDeckWithMultipleSections(page)
    await page.goto('#/deck/test-multi-section-deck')
    await page.waitForSelector('.card-item')

    await openFormat(page, 'Download')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.selection-menu-panel button', { hasText: 'Text (.txt)' }).click(),
    ])

    expect(download.suggestedFilename()).toBe('Test_Multi_Section_Deck.txt')
    const content = readFileSync(await download.path(), 'utf-8')
    expect(content).toContain('## Main')
    expect(content).toContain('1 Test Creature')
    // Plain-text export, not markdown: no printing suffix or card-id tokens.
    expect(content).not.toContain('(TST:')
    expect(content).not.toContain('&')

    // The feedback tooltip confirms the action without changing the button label.
    await expect(page.locator('.export-feedback')).toHaveText('Downloaded!')
    await expect(
      page.locator('.export-menu-control button', { hasText: 'Download' }),
    ).toContainText('Download')
  })

  test('downloads a collection as CSV with the canonical header and rows', async ({ page }) => {
    await mockPublicSiteCollection(page)
    await page.goto('#/collection/test-collection')
    await page.waitForSelector('.card-item')

    await openFormat(page, 'Download')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.selection-menu-panel button', { hasText: 'CSV (.csv)' }).click(),
    ])

    expect(download.suggestedFilename()).toBe('Test_Collection.csv')
    const lines = readFileSync(await download.path(), 'utf-8').split('\n')
    expect(lines[0]).toBe('Name,Set,Collector Number,Finish,Condition,Quantity')
    expect(lines).toContain('Priced Card,TST,10,nonfoil,NM,1')
    expect(lines).toContain('Unpriced Card,TST,11,nonfoil,NM,1')
  })

  test('copies a wanted list to the clipboard as text', async ({ page }) => {
    await mockPublicSiteWantedList(page)
    await page.goto('#/wanted/test-wanted-list')
    await page.waitForSelector('.card-item')

    await openFormat(page, 'Copy')
    await page.locator('.selection-menu-panel button', { hasText: 'Text (.txt)' }).click()

    await expect(page.locator('.export-feedback')).toHaveText('Copied!')
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    // Name-only entry carries no printing suffix; specific printings uppercase the set.
    expect(clipboard).toContain('1 Lightning Bolt\n')
    expect(clipboard).toContain('1 Sol Ring (C19:221)')
    expect(clipboard).toContain('1 Mana Crypt (2XM:270)')
  })
})
