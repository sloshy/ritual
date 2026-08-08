import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithChangelog } from '../helpers/mock-public-site'

test.describe('View Changes', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithChangelog(page)
    await page.goto('#/deck/test-changelog-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
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

    // The change-text formatting itself is unit-tested exhaustively in
    // test/unit/change-message.test.ts; here we only pin that the modal
    // wires the formatted text and the additive/destructive styling into the DOM.
    const added = modal.locator('.changelog-change-item', {
      hasText: 'Added Maybe Card to Maybeboard',
    })
    await expect(added).toBeVisible()
    await expect(added).toHaveClass(/changelog-change-item--add/)

    const removed = modal.locator('.changelog-change-item', {
      hasText: 'Cleared note on Plain Card',
    })
    await expect(removed).toBeVisible()
    await expect(removed).toHaveClass(/changelog-change-item--remove/)
  })

  test('changelog modal can be dismissed', async ({ page }) => {
    const modal = page.locator('.changelog-modal')
    const openModal = async (): Promise<void> => {
      await page.getByRole('button', { name: 'View Changes' }).click()
      await expect(modal).toBeVisible()
    }

    // Close button (the only ChangelogModal-specific control).
    await openModal()
    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).not.toBeVisible()

    // Escape key (shared Modal behavior).
    await openModal()
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()

    // Backdrop click on the dialog shell's padding area (shared Modal behavior).
    await openModal()
    await page.locator('.modal-shell[open]').click({ position: { x: 5, y: 5 } })
    await expect(modal).not.toBeVisible()
  })
})
