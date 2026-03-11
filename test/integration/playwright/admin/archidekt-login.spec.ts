import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'

test.describe('Archidekt Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
    await page.locator('.admin-nav-item:has-text("Archidekt Login")').click()
    await expect(page.locator('.section-heading')).toContainText('Archidekt Login')
  })

  test('login button is disabled when fields are empty', async ({ page }) => {
    const button = page.locator('button:has-text("Login to Archidekt")')
    await expect(button).toBeDisabled()
  })

  test('login button remains disabled when only username is filled', async ({ page }) => {
    await page.fill('input[type="text"]', 'myuser')
    const button = page.locator('button:has-text("Login to Archidekt")')
    await expect(button).toBeDisabled()
  })

  test('login button remains disabled when only password is filled', async ({ page }) => {
    await page.fill('input[type="password"]', 'mypass')
    const button = page.locator('button:has-text("Login to Archidekt")')
    await expect(button).toBeDisabled()
  })

  test('login button enables when both fields are filled', async ({ page }) => {
    await page.fill('input[type="text"]', 'myuser')
    await page.fill('input[type="password"]', 'mypass')
    const button = page.locator('button:has-text("Login to Archidekt")')
    await expect(button).toBeEnabled()
  })

  test('successful login shows success message', async ({ page }) => {
    await page.route('**/api/login/archidekt', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Logged in to Archidekt' }),
      })
    })
    await page.fill('input[type="text"]', 'myuser')
    await page.fill('input[type="password"]', 'mypass')
    await page.locator('button:has-text("Login to Archidekt")').click()
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  })
})
