import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithDescription } from '../helpers/mock-public-site'

test.describe('Deck Description Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithDescription(page)
    await page.goto('#/deck/test-description-deck')
    await page.waitForSelector('.deck-description', { timeout: 15_000 })
  })

  test('long description truncates, expands via "Read more", and collapses via "Show less"', async ({
    page,
  }) => {
    const toggleBtn = page.locator('.deck-description .link-action')
    const description = page.locator('.deck-description .text-preformatted')

    // Initially truncated: text ends with an ellipsis and the button offers more.
    const truncatedText = await description.textContent()
    expect(truncatedText).toContain('…')
    await expect(toggleBtn).toHaveText('Read more')

    // Expand: button flips to "Show less" and the full text renders.
    await toggleBtn.click()
    await expect(toggleBtn).toHaveText('Show less')
    const expandedText = await description.textContent()
    expect(expandedText).not.toContain('…')
    expect(expandedText!.length).toBeGreaterThan(truncatedText!.length)

    // Collapse: back to the truncated form.
    await toggleBtn.click()
    await expect(toggleBtn).toHaveText('Read more')
    const collapsedText = await description.textContent()
    expect(collapsedText).toContain('…')
    expect(collapsedText!.length).toBeLessThan(expandedText!.length)
  })
})
