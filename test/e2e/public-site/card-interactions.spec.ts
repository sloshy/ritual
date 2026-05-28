import { test, expect } from '@playwright/test'

test.describe('Card Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/deck/black-panther')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('hovering a card in list view shows a tooltip', async ({ page }) => {
    await page.locator('[data-view="list"]').click()
    const cardList = page.locator('.card-list').first()
    await expect(cardList).toBeVisible()
    await cardList.hover()
    await expect(page.locator('.list-tooltip.visible')).toBeVisible({ timeout: 2000 })
  })

  test('clicking a card opens a modal', async ({ page }) => {
    const card = page.locator('.card-item').first()
    await expect(card).toBeVisible()
    await card.locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
  })

  test('modal closes on Escape', async ({ page }) => {
    const card = page.locator('.card-item').first()
    await expect(card).toBeVisible()
    await card.locator('.card-binder').click()
    await expect(page.locator('.card-modal')).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.card-modal-backdrop.open')).not.toBeVisible({ timeout: 3000 })
  })
})
