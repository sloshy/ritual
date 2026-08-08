import { type Page, expect } from '@playwright/test'
import { type ListType, listTypeTitle } from '../../../src/list-type'

/** The list selector each editor renders, keyed by list type. */
export const SELECTOR_ID: Record<ListType, string> = {
  deck: '#deck-select',
  collection: '#collection-select',
  wanted: '#wanted-list-select',
}

/**
 * Open the consolidated "Edit Lists" page and activate the given type's tab,
 * waiting until that editor's list selector is present.
 */
export async function openListEditor(page: Page, type: ListType): Promise<void> {
  await page.locator('.admin-nav-item:has-text("Edit Lists")').click()
  await expect(page.locator('.section-heading')).toContainText('Edit Lists')
  await page.locator(`.list-type-tab:has-text("${listTypeTitle(type)}")`).click()
  await expect(page.locator(SELECTOR_ID[type])).toBeVisible()
}

/**
 * Pick a list in the open editor's selector. The selector is populated from a
 * fetch, so it starts holding only its placeholder — selecting before the real
 * options arrive silently fails.
 */
export async function selectList(page: Page, type: ListType, slug: string): Promise<void> {
  const id = SELECTOR_ID[type]
  await page.waitForFunction(
    (selector) => (document.querySelector<HTMLSelectElement>(selector)?.options.length ?? 0) > 1,
    id,
    { timeout: 10_000 },
  )
  await page.locator(id).selectOption(slug)
}
