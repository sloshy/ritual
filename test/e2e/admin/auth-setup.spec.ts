import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { loginAsAdmin, ADMIN_STORAGE_STATE } from '../helpers/auth-helper'
import { getAdminAuthFile } from '../helpers/workspace'

const ADMIN_URL = 'http://localhost:8456'

async function ensureSetupRequired(): Promise<void> {
  // Delete the admin server's stored credentials (inside the synthetic
  // workspace) and verify the server sees setupRequired=true.
  // Retry because parallel workers may recreate the file.
  const authFile = getAdminAuthFile()
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(authFile)) {
      fs.unlinkSync(authFile)
    }
    const resp = await fetch(`${ADMIN_URL}/api/status`)
    const data = (await resp.json()) as { setupRequired: boolean }
    if (data.setupRequired) return
    await new Promise((r) => setTimeout(r, 100))
  }
}

test.describe('Auth Setup', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    await ensureSetupRequired()
  })

  test('shows setup form when no user exists', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.locator('text=Create your admin account')).toBeVisible()
    const title = page.locator('.login-title')
    await expect(title).toContainText('Ritual Admin')
    // The brand mark is the shared flame logo, not an emoji.
    await expect(title.locator('svg[aria-label="Ritual logo"]')).toBeVisible()
  })

  test('successful setup transitions to dashboard', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.waitForSelector('text=Create your admin account')
    await page.fill('input[type="text"]', 'testadmin')
    await page.fill('input[type="password"]', 'testpass123')
    await page.click('button[type="submit"]')
    // Should transition to dashboard with sidebar
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 10_000 })
  })
})

// Runs after the setup-flow tests above (this project is not fully parallel, so
// file order holds). Performs one real login and saves the session cookie as
// Playwright storage state; the `admin` project loads it via `use.storageState`
// so its specs start already authenticated.
test.describe('Auth State Capture', () => {
  test('logs in and saves storage state for the admin project', async ({ page }) => {
    await loginAsAdmin(page)
    fs.mkdirSync(path.dirname(ADMIN_STORAGE_STATE), { recursive: true })
    await page.context().storageState({ path: ADMIN_STORAGE_STATE })
  })
})
