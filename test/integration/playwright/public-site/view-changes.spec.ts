import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithChangelog } from '../helpers/mock-data'

test.describe('View Changes', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithChangelog(page)
    await page.goto('#/deck/test-changelog-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('View Changes button is visible for deck with changelog', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'View Changes' })).toBeVisible()
  })

  test('clicking View Changes opens the changelog modal', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.getByRole('heading', { name: 'Change History' })).toBeVisible()
  })

  test('changelog modal displays timestamp and change entries', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    const modal = page.locator('.changelog-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.changelog-timestamp')).toBeVisible()
    await expect(modal.locator('.changelog-change-item').first()).toBeVisible()
  })

  test('changelog modal annotates non-main board changes', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    const modal = page.locator('.changelog-modal')
    await expect(modal).toBeVisible()
    // Adds to a non-main board read "... to Maybeboard"; removes read "... from Sideboard".
    await expect(
      modal.locator('.changelog-change-item', { hasText: 'Added Maybe Card to Maybeboard' }),
    ).toBeVisible()
    await expect(
      modal.locator('.changelog-change-item', { hasText: 'Removed Side Card from Sideboard' }),
    ).toBeVisible()
  })

  test('changelog modal can be closed with the close button', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.locator('.changelog-modal')).toBeVisible()
    await page.locator('.changelog-modal').getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.changelog-modal')).not.toBeVisible()
  })

  test('changelog modal can be closed by pressing Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.locator('.changelog-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.changelog-modal')).not.toBeVisible()
  })

  test('changelog modal can be closed by clicking the backdrop', async ({ page }) => {
    await page.getByRole('button', { name: 'View Changes' }).click()
    await expect(page.locator('.changelog-modal')).toBeVisible()
    await page.locator('.changelog-modal-backdrop').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.changelog-modal')).not.toBeVisible()
  })
})
