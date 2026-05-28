import { test, expect } from '@playwright/test'

// Tests for the header "Theme" picker popover. The picker is the primary
// entry point for switching base themes; the legacy "Customize theme…"
// editor opens from inside it.

test.describe('Theme picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('switches base theme without prompting when no customizations exist', async ({ page }) => {
    await page.getByRole('button', { name: 'Theme', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Choose theme' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('option', { name: /izzet/ }).first().click()

    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('izzet')

    // Only the theme name is stored — not a full snapshot of the palette.
    const stored = await page.evaluate(() => localStorage.getItem('ritual:theme'))
    expect(stored).toBe('izzet')
    const overrides = await page.evaluate(() => localStorage.getItem('ritual:custom-vars'))
    expect(overrides).toBeNull()
  })

  test('prompts before switching when customizations exist; cancel preserves overrides and theme', async ({
    page,
  }) => {
    // Seed an override directly so we don't need to drive the editor UI.
    await page.evaluate(() => {
      localStorage.setItem('ritual:theme', 'izzet')
      localStorage.setItem(
        'ritual:custom-vars',
        JSON.stringify({ '--accent': 'oklch(50% 0.2 30)' }),
      )
    })
    await page.reload()

    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose theme' })
    await dialog.getByRole('option', { name: /gruul/ }).first().click()

    const confirm = page.getByRole('alertdialog', { name: 'Discard customizations?' })
    await expect(confirm).toBeVisible()

    await confirm.getByRole('button', { name: 'Cancel' }).click()

    // Cancel keeps both the original theme and the override intact.
    const theme = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(theme).toBe('izzet')
    const inline = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent'),
    )
    expect(inline).toBe('oklch(50% 0.2 30)')
  })

  test('confirming the prompt clears overrides and switches base theme', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('ritual:theme', 'izzet')
      localStorage.setItem(
        'ritual:custom-vars',
        JSON.stringify({ '--accent': 'oklch(50% 0.2 30)' }),
      )
    })
    await page.reload()

    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Choose theme' })
      .getByRole('option', { name: /gruul/ })
      .first()
      .click()

    await page
      .getByRole('alertdialog', { name: 'Discard customizations?' })
      .getByRole('button', { name: 'Discard & switch' })
      .click()

    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('gruul')

    // Inline override on :root is gone; localStorage entry is gone too.
    const inline = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent'),
    )
    expect(inline).toBe('')
    const stored = await page.evaluate(() => localStorage.getItem('ritual:custom-vars'))
    expect(stored).toBeNull()
  })

  test('Customize theme entry opens the editor and closes the picker', async ({ page }) => {
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await page.getByRole('button', { name: /Customize theme/ }).click()

    await expect(page.locator('.theme-editor')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Choose theme' })).toBeHidden()
  })
})
