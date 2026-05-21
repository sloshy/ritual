import { test, expect, type Page } from '@playwright/test'

// Tests for the runtime theme editor reached via the header's "Theme"
// menu → "Customize theme…" entry. Each test starts with a clean
// localStorage so the editor boots in the default state.

async function openThemeEditor(page: Page) {
  await page.getByRole('button', { name: 'Theme', exact: true }).click()
  await page.getByRole('button', { name: /Customize theme/ }).click()
}

test.describe('Theme editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('overriding a variable and resetting snaps the slider back to the active base theme', async ({
    page,
  }) => {
    await openThemeEditor(page)
    await page.getByRole('combobox', { name: 'Base:' }).selectOption('izzet')

    // Sanity: the data-theme attribute and resolved var reflect izzet, not
    // any stale default state.
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('izzet')
    const izzetPanel = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim(),
    )
    expect(izzetPanel).toBe('oklch(24% 0.035 245)')

    await page.getByRole('button', { name: 'Panel background' }).click()
    const lSlider = page.getByRole('slider', { name: 'L' })
    await expect(lSlider).toHaveValue('24')

    await lSlider.fill('80')
    await expect(lSlider).toHaveValue('80')
    const cssTextbox = page.getByRole('textbox', { name: 'CSS' })
    await expect(cssTextbox).toHaveValue('oklch(80% 0.035 245)')

    await page.getByRole('button', { name: 'Reset to base theme' }).click()

    // Slider snaps back to izzet's L=24, NOT default's L=24 with default's
    // chroma/hue — assert the full CSS string to catch that regression.
    await expect(lSlider).toHaveValue('24')
    await expect(cssTextbox).toHaveValue('oklch(24% 0.035 245)')
  })

  test('color picker popover appears above page content', async ({ page }) => {
    await openThemeEditor(page)
    await page.getByRole('button', { name: 'Panel background' }).click()

    const popover = page.getByRole('dialog', { name: /Edit Panel background/ })
    await expect(popover).toBeVisible()

    // The popover must escape the toolbar's overflow:auto clipping box. Its
    // bottom edge should sit below the toolbar's bottom — if it were
    // position:absolute and clipped, it would visually stop at the toolbar
    // bottom even though it's "in" the DOM.
    const box = await popover.boundingBox()
    const toolbarBottom = await page
      .locator('.theme-editor')
      .evaluate((el) => el.getBoundingClientRect().bottom)
    expect(box).not.toBeNull()
    expect(box!.y + box!.height).toBeGreaterThan(toolbarBottom)
  })

  test('overrides apply as inline styles on :root regardless of base theme', async ({ page }) => {
    await openThemeEditor(page)
    await page.getByRole('combobox', { name: 'Base:' }).selectOption('gruul')

    await page.getByRole('button', { name: 'Panel background' }).click()
    await page.getByRole('slider', { name: 'L' }).fill('60')

    // The data-theme attribute stays at the user's chosen base theme — it
    // does NOT flip to a "custom" sentinel that would hide the gruul rule.
    const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(dataTheme).toBe('gruul')

    // The override is an inline style on :root (so it outranks any
    // stylesheet rule from the active theme).
    const inline = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--bg-panel'),
    )
    expect(inline).toBe('oklch(60% 0.04 145)')
  })

  test('reset all clears every inline override without changing the base theme', async ({
    page,
  }) => {
    await openThemeEditor(page)
    await page.getByRole('combobox', { name: 'Base:' }).selectOption('rakdos')

    await page.getByRole('button', { name: 'Panel background' }).click()
    await page.getByRole('slider', { name: 'L' }).fill('70')
    // Close popover so it doesn't intercept the Reset all click.
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Reset all' }).click()

    // No theme-override vars remain. The layout-measurement vars
    // (--theme-editor-h, --site-header-h) are set inline by the editor/header
    // and are not theme overrides, so Reset all intentionally leaves them.
    const overrideVars = await page.evaluate(
      (layoutVars) =>
        Array.from(document.documentElement.style).filter((prop) => !layoutVars.includes(prop)),
      ['--theme-editor-h', '--site-header-h'],
    )
    expect(overrideVars).toEqual([])

    // Base theme stays at rakdos.
    const dataTheme = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(dataTheme).toBe('rakdos')
  })
})
