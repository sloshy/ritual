import { type Page, type BrowserContext, request } from '@playwright/test'

const ADMIN_URL = 'http://localhost:8456'
const TEST_USER = 'testadmin'
const TEST_PASS = 'testpass123'

/**
 * Perform initial admin setup (create account) if needed,
 * then log in and return the authenticated page.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  // Ensure the admin user exists before attempting login
  await setupAdminViaApi(ADMIN_URL)

  await page.goto(ADMIN_URL)

  // Wait for either login form, setup form, or dashboard (already logged in)
  const loginForm = page.locator('text=Sign in to continue')
  const setupForm = page.locator('text=Create your admin account')
  const dashboard = page.locator('.admin-sidebar')

  await Promise.race([
    loginForm.waitFor({ timeout: 10_000 }).catch(() => {}),
    setupForm.waitFor({ timeout: 10_000 }).catch(() => {}),
    dashboard.waitFor({ timeout: 10_000 }).catch(() => {}),
  ])

  // If already on dashboard, we're done
  if (await dashboard.isVisible()) return

  if (await setupForm.isVisible()) {
    await page.fill('input[type="text"]', TEST_USER)
    await page.fill('input[type="password"]', TEST_PASS)
    await page.click('button[type="submit"]')
    await dashboard.waitFor({ timeout: 10_000 })
    return
  }

  // Login via form
  await page.fill('input[type="text"]', TEST_USER)
  await page.fill('input[type="password"]', TEST_PASS)
  await page.click('button[type="submit"]')
  await dashboard.waitFor({ timeout: 10_000 })
}

/**
 * Set up admin via API (faster, for use in beforeAll/beforeEach)
 */
export async function setupAdminViaApi(baseURL: string): Promise<void> {
  const ctx = await request.newContext({ baseURL })
  try {
    const statusResp = await ctx.get('/api/status')
    const status = (await statusResp.json()) as { setupRequired: boolean }

    if (status.setupRequired) {
      await ctx.post('/api/setup', {
        data: { username: TEST_USER, password: TEST_PASS },
      })
    }
  } finally {
    await ctx.dispose()
  }
}

/**
 * Login via API and store cookies in the browser context
 */
export async function loginViaApi(context: BrowserContext, baseURL: string): Promise<void> {
  const ctx = await request.newContext({ baseURL })
  try {
    const loginResp = await ctx.post('/api/login', {
      data: { username: TEST_USER, password: TEST_PASS },
    })
    // Extract Set-Cookie headers and add them to the browser context
    const headers = loginResp.headers()
    const setCookie = headers['set-cookie']
    if (setCookie) {
      const url = new URL(baseURL)
      const [nameValue] = setCookie.trim().split(';')
      const [name, value] = nameValue!.split('=')
      await context.addCookies([
        {
          name: name!.trim(),
          value: value!.trim(),
          domain: url.hostname,
          path: '/',
        },
      ])
    }
  } finally {
    await ctx.dispose()
  }
}

export { TEST_USER, TEST_PASS, ADMIN_URL }
