import { test, expect } from '@playwright/test'
import {
  mockPublicSiteCollection,
  mockPublicSiteDeckWithDescription,
  mockPublicSiteWantedList,
} from '../helpers/mock-public-site'

/**
 * The front-matter `description:` every list type carries, rendered by the one
 * shared component: long text collapses behind Read more, short text renders
 * whole, and the flat list pages print it as the deck page does.
 */

test.describe('List Description', () => {
  test('a long deck description truncates, expands, and collapses again', async ({ page }) => {
    await mockPublicSiteDeckWithDescription(page)
    await page.goto('#/deck/test-description-deck')
    await page.waitForSelector('.list-description', { timeout: 15_000 })

    const toggleBtn = page.locator('.list-description .link-action')
    const description = page.locator('.list-description .text-preformatted')

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

  test('a collection prints its short description whole, with no toggle', async ({ page }) => {
    await mockPublicSiteCollection(page)
    await page.goto('#/collection/test-collection')

    const description = page.locator('.list-description .text-preformatted')
    await expect(description).toHaveText('Everything I will trade away.')
    await expect(page.locator('.list-description .link-action')).toHaveCount(0)
  })

  test('a wanted list collapses its long description behind Read more', async ({ page }) => {
    await mockPublicSiteWantedList(page)
    await page.goto('#/wanted/test-wanted-list')

    const toggleBtn = page.locator('.list-description .link-action')
    await expect(toggleBtn).toHaveText('Read more')
    await expect(page.locator('.list-description .text-preformatted')).toContainText('…')

    await toggleBtn.click()
    await expect(toggleBtn).toHaveText('Show less')
    await expect(page.locator('.list-description .text-preformatted')).toContainText(
      'exactly as a deck description is collapsed.',
    )
  })
})
