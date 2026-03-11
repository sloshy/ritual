import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ADMIN_URL = 'http://localhost:8456'
const AUTH_FILE = path.resolve(__dirname, '../../../../.logins/admin-auth.json')

async function ensureSetupRequired(): Promise<void> {
  // Delete auth file and verify the server sees setupRequired=true.
  // Retry because parallel workers may recreate the file.
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE)
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
    await expect(page.locator('text=⚗️ Ritual Admin')).toBeVisible()
  })

  test('shows error when fields are empty', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.waitForSelector('text=Create your admin account')
    await page.click('button[type="submit"]')
    await expect(page.locator('.alert-error')).toContainText('Username and password are required')
  })

  test('shows error for short password', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await page.waitForSelector('text=Create your admin account')
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'ab')
    await page.click('button[type="submit"]')
    await expect(page.locator('.alert-error')).toContainText(
      'Password must be at least 4 characters',
    )
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
