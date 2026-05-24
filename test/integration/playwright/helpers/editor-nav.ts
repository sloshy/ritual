import { type Page, expect } from '@playwright/test'
import { type ListType, LIST_TYPE_DISPLAY } from '../../../../src/list-type'

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
  await page.locator(`.list-type-tab:has-text("${LIST_TYPE_DISPLAY[type].label}")`).click()
  await expect(page.locator(SELECTOR_ID[type])).toBeVisible()
}
