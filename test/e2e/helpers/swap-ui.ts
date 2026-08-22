import { type Locator, type Page, expect } from '@playwright/test'

/**
 * Locators for the Swap Printings wizard, which the public site and the admin
 * editors render from the same component (`SwapPrintingsWizard.tsx`) — so one
 * spelling of its classes serves both specs.
 */

export const wizardOf = (page: Page): Locator => page.locator('.swap-wizard-modal')
export const currentStep = (wizard: Locator): Locator =>
  wizard.locator('.swap-wizard-step--current')
export const footerButton = (wizard: Locator, label: string): Locator =>
  wizard.locator('.swap-wizard-footer button', { hasText: label })
export const backButton = (wizard: Locator): Locator =>
  wizard.locator('.swap-wizard-header .search-tab-btn', { hasText: 'Back' })
/** A Cards-step row by card name. */
export const cardRow = (wizard: Locator, name: string): Locator =>
  wizard.locator('.swap-wizard-card-row', { hasText: name })
/** The picker's candidate rows. */
export const candidateRows = (wizard: Locator): Locator =>
  wizard.locator('.swap-wizard-candidate-row')
/** A candidate row's "+" take-count button. */
export const takeOneButton = (row: Locator): Locator =>
  row.getByRole('button', { name: 'Increase quantity' })

/** Click Next and wait for the wizard to land on `step`. */
export async function goNext(wizard: Locator, step: string): Promise<void> {
  await footerButton(wizard, 'Next').click()
  await expect(currentStep(wizard)).toHaveText(step)
}
