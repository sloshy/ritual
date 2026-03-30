import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithDescription } from '../helpers/mock-data'

test.describe('Deck Description Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithDescription(page)
    await page.goto('#/deck/test-description-deck')
    await page.waitForSelector('.deck-description', { timeout: 15_000 })
  })

  test('long description is initially truncated with "Read more" button', async ({ page }) => {
    const description = page.locator('.deck-description .text-preformatted')
    const descText = await description.textContent()
    // Truncated descriptions end with an ellipsis character
    expect(descText).toContain('…')

    const readMoreBtn = page.locator('.deck-description .link-action')
    await expect(readMoreBtn).toHaveText('Read more')
  })

  test('clicking "Read more" expands description and button changes to "Show less"', async ({
    page,
  }) => {
    const readMoreBtn = page.locator('.deck-description .link-action')
    const description = page.locator('.deck-description .text-preformatted')

    // Capture truncated text
    const truncatedText = await description.textContent()
    expect(truncatedText).toContain('…')

    // Click read more
    await readMoreBtn.click()

    // Button should now say "Show less"
    await expect(readMoreBtn).toHaveText('Show less')

    // Description should be longer and no longer end with ellipsis
    const expandedText = await description.textContent()
    expect(expandedText).not.toContain('…')
    expect(expandedText!.length).toBeGreaterThan(truncatedText!.length)
  })

  test('clicking "Show less" re-truncates the description', async ({ page }) => {
    const toggleBtn = page.locator('.deck-description .link-action')
    const description = page.locator('.deck-description .text-preformatted')

    // Expand first
    await toggleBtn.click()
    await expect(toggleBtn).toHaveText('Show less')
    const expandedText = await description.textContent()

    // Collapse
    await toggleBtn.click()
    await expect(toggleBtn).toHaveText('Read more')

    // Text should be truncated again
    const collapsedText = await description.textContent()
    expect(collapsedText).toContain('…')
    expect(collapsedText!.length).toBeLessThan(expandedText!.length)
  })
})
