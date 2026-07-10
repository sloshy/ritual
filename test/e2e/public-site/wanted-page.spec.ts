import { test, expect } from '@playwright/test'
import { mockPublicSiteWantedList } from '../helpers/mock-public-site'

test.describe('Wanted List Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteWantedList(page)
    await page.goto('#/wanted/test-wanted-list')
    await page.waitForSelector('.card-item', { timeout: 15_000 })
  })

  test('clicking a card opens the card detail modal', async ({ page }) => {
    await page.locator('.card-item').first().click()
    await expect(page.locator('.card-modal, [class*="modal"]').first()).toBeVisible({
      timeout: 5_000,
    })
  })

  test('grouping by printing splits specific and any-printing entries', async ({ page }) => {
    // All three mocked entries render, with the card count and price shown.
    expect(await page.locator('.card-item').count()).toBe(3)
    const bodyText = await page.textContent('body')
    expect(bodyText).toMatch(/3\s*cards?/i)
    expect(bodyText).toMatch(/\$[\d.]+/)

    // Switch to list view so card names render as text within each section.
    await page.locator('[data-view="list"]').click()

    // The first toolbar select is the "Group:" dropdown.
    await page.locator('.toolbar select').first().selectOption('printing')

    const specific = page.locator('[data-section="Specific Printing"]')
    const any = page.locator('[data-section="Any Printing"]')
    await expect(specific).toBeVisible()
    await expect(any).toBeVisible()

    // Lightning Bolt is name-only → Any Printing.
    await expect(any).toContainText('Lightning Bolt')
    // Sol Ring and Mana Crypt are pinned to a printing → Specific Printing.
    await expect(specific).toContainText('Sol Ring')
    await expect(specific).toContainText('Mana Crypt')
  })
})
