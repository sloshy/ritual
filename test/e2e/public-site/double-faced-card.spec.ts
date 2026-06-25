import { test, expect } from '@playwright/test'
import { mockPublicSiteDeckWithDoubleFacedCard } from '../helpers/mock-data'

// The synthetic deck has a double-faced card ("Werewolf Front // Werewolf Back",
// a Creature front with a Land back) and a plain land ("Test Wastes").
const DFC = '.card-item[data-name="werewolf front // werewolf back"]'
const LAND = '.card-item[data-name="test wastes"]'

test.describe('Double-faced cards', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicSiteDeckWithDoubleFacedCard(page)
    await page.goto('#/deck/test-dfc-deck')
    await page.waitForSelector('[data-view]', { timeout: 15_000 })
  })

  test('groups a double-faced card by its front face (Creature, not Land)', async ({ page }) => {
    // Default group-by is 'type'. The DFC's front is a Creature, so it must land
    // in the Creature section even though its back face is a Land.
    await expect(page.locator(`[data-section="Creature"] ${DFC}`)).toHaveCount(1)
    await expect(page.locator(`[data-section="Land"] ${DFC}`)).toHaveCount(0)
    // The genuinely-land card stays in the Land section.
    await expect(page.locator(`[data-section="Land"] ${LAND}`)).toHaveCount(1)
  })

  test('flip button toggles the face in place in binder view', async ({ page }) => {
    const dfc = page.locator(DFC)
    const flipBtn = dfc.locator('.card-flip-btn')
    const flipWrap = dfc.locator('.card-flip')

    await expect(flipBtn).toHaveCount(1)
    await expect(flipWrap).not.toHaveClass(/flipped/)

    // The two faces carry the distinct front/back images (guards against a
    // front/back transposition that the class toggle alone would not catch).
    await expect(dfc.locator('.card-flip-front')).toHaveAttribute('src', /dfc-front\.svg/)
    await expect(dfc.locator('.card-flip-back')).toHaveAttribute('src', /dfc-back\.svg/)

    await dfc.locator('.card-binder').hover()
    await flipBtn.click()
    await expect(flipWrap).toHaveClass(/flipped/)

    // Pressing again on the back flips it back to the front.
    await flipBtn.click()
    await expect(flipWrap).not.toHaveClass(/flipped/)
  })

  test('flip button only appears on double-faced cards', async ({ page }) => {
    // The plain land is single-faced and gets no flip button.
    await expect(page.locator(`${LAND} .card-flip-btn`)).toHaveCount(0)
    // ...and it has no flip wrapper, just a plain image.
    await expect(page.locator(`${LAND} .card-flip`)).toHaveCount(0)
  })

  test('modal flip button animates the face via the rotateY flip container', async ({ page }) => {
    // Open the detail modal for the DFC.
    await page.locator(DFC).locator('.card-binder').click()
    const modal = page.locator('.card-modal-backdrop.open')
    await expect(modal).toBeVisible({ timeout: 5000 })

    // The modal renders the animated flip container (not a plain swapped <img>),
    // with both faces mounted carrying the distinct front/back images.
    const flipWrap = modal.locator('.card-modal-flip')
    await expect(flipWrap).toHaveCount(1)
    await expect(flipWrap).not.toHaveClass(/flipped/)
    await expect(flipWrap.locator('img').first()).toHaveAttribute('src', /dfc-front\.svg/)
    await expect(flipWrap.locator('.card-modal-flip-back')).toHaveAttribute('src', /dfc-back\.svg/)

    // Pressing flip rotates to the back, and again returns to the front — the
    // class toggle is what drives the CSS rotateY transition.
    await modal.locator('.flip-btn').click()
    await expect(flipWrap).toHaveClass(/flipped/)
    await modal.locator('.flip-btn').click()
    await expect(flipWrap).not.toHaveClass(/flipped/)
  })

  test('flip button is absent in list view but present in stack view', async ({ page }) => {
    await page.locator('[data-view="list"]').click()
    await expect(page.locator('.card-flip-btn')).toHaveCount(0)

    await page.locator('[data-view="stack"]').click()
    const dfc = page.locator(DFC)
    await dfc.locator('.card-overlap').hover()
    const flipBtn = dfc.locator('.card-flip-btn')
    await expect(flipBtn).toHaveCount(1)
    await flipBtn.click()
    await expect(dfc.locator('.card-flip')).toHaveClass(/flipped/)
  })
})
