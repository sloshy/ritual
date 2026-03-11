import { test, expect } from '@playwright/test'
import { setupAdminViaApi, TEST_USER, TEST_PASS, ADMIN_URL } from '../helpers/auth-helper'

test.describe('Auth Login', () => {
  test.beforeEach(async () => {
    // Ensure admin user exists before each login test
    await setupAdminViaApi(ADMIN_URL)
  })

  test('shows login form when user exists', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.locator('text=Sign in to continue')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toContainText('Sign In')
  })

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.waitForSelector('text=Sign in to continue')
    await page.fill('input[type="text"]', 'wronguser')
    await page.fill('input[type="password"]', 'wrongpass')
    await page.click('button[type="submit"]')
    await expect(page.locator('.alert-error')).toBeVisible({ timeout: 5000 })
  })

  test('successful login shows dashboard', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.waitForSelector('text=Sign in to continue', { timeout: 10_000 })
    await page.fill('input[type="text"]', TEST_USER)
    await page.fill('input[type="password"]', TEST_PASS)
    await page.click('button[type="submit"]')
    // After login, the sidebar + dashboard should appear
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 10_000 })
  })

  test('logout returns to login form', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.waitForSelector('text=Sign in to continue', { timeout: 10_000 })
    await page.fill('input[type="text"]', TEST_USER)
    await page.fill('input[type="password"]', TEST_PASS)
    await page.click('button[type="submit"]')
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 10_000 })
    // Click logout button
    await page.locator('button:has-text("Logout")').first().click()
    await expect(page.locator('text=Sign in to continue')).toBeVisible({ timeout: 5000 })
  })
})
