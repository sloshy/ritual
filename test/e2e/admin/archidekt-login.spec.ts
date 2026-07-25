import { test, expect, type Page } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJsonRoute } from '../helpers/fulfill'
import {
  ARCHIDEKT_LOGGED_IN as LOGGED_IN_VALID,
  ARCHIDEKT_NOT_LOGGED_IN as NOT_LOGGED_IN,
  ARCHIDEKT_SESSION_EXPIRED as SESSION_EXPIRED,
} from '../helpers/mock-admin'
import type { ArchidektLoginStatus } from '../../../src/auth/interfaces'

// Intercept both the status GET and the login POST on the shared endpoint.
async function mockArchidekt(
  page: Page,
  status: ArchidektLoginStatus,
  loginSuccess = true,
): Promise<void> {
  await page.route('**/api/login/archidekt', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJsonRoute(route, status)
    } else {
      await fulfillJsonRoute(
        route,
        {
          success: loginSuccess,
          message: loginSuccess ? 'Logged in to Archidekt' : 'Login failed',
        },
        loginSuccess ? 200 : 401,
      )
    }
  })
}

async function gotoArchidekt(page: Page): Promise<void> {
  await page.locator('.admin-nav-item:has-text("Archidekt Login")').click()
  await expect(page.locator('.section-heading')).toContainText('Archidekt Login')
}

test.describe('Archidekt Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAdminDashboard(page)
  })

  test('login button enables only when both fields are filled', async ({ page }) => {
    await mockArchidekt(page, NOT_LOGGED_IN)
    await gotoArchidekt(page)
    const button = page.locator('button:has-text("Login to Archidekt")')
    // Disabled when empty
    await expect(button).toBeDisabled()
    // Still disabled with only username
    await page.fill('input[type="text"]', 'myuser')
    await expect(button).toBeDisabled()
    // Enabled when both are filled
    await page.fill('input[type="password"]', 'mypass')
    await expect(button).toBeEnabled()
  })

  test('successful login shows success message', async ({ page }) => {
    await mockArchidekt(page, NOT_LOGGED_IN)
    await gotoArchidekt(page)
    await page.fill('input[type="text"]', 'myuser')
    await page.fill('input[type="password"]', 'mypass')
    await page.locator('button:has-text("Login to Archidekt")').click()
    await expect(page.locator('.alert-success')).toBeVisible({ timeout: 5000 })
  })

  test('shows token validity when signed in', async ({ page }) => {
    await mockArchidekt(page, LOGGED_IN_VALID)
    await gotoArchidekt(page)

    await expect(page.locator('.alert-success')).toContainText('Signed in as testuser')
    await expect(
      page.locator('.archidekt-status-row', { hasText: 'Current login (access token)' }),
    ).toContainText('valid for')
    await expect(page.locator('.archidekt-status-row', { hasText: 'Refresh token' })).toContainText(
      'valid for',
    )
  })

  test('shows a login-required message when the session has expired', async ({ page }) => {
    await mockArchidekt(page, SESSION_EXPIRED)
    await gotoArchidekt(page)

    await expect(page.locator('.alert-error')).toContainText(
      'A login is required to use Archidekt account features',
    )
    await expect(page.locator('.archidekt-status-row', { hasText: 'Refresh token' })).toContainText(
      'expired',
    )
  })
})
