import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockAuditLogApi, MOCK_AUDIT_ENTRIES } from '../helpers/mock-data'

test.describe('Audit Log Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuditLogApi(page)
    await loginAsAdmin(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Audit Log")').click()
    await expect(page.locator('.section-heading')).toContainText('Audit Log')
  })

  test('refresh button fetches updated data and re-renders the table', async ({ page }) => {
    const updatedEntry = {
      ...MOCK_AUDIT_ENTRIES[0],
      username: 'refreshed-user',
      timestamp: new Date().toISOString(),
    }
    await page.route('**/api/audit-log*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, entries: [updatedEntry] }),
      })
    })
    const main = page.locator('main')
    await main.locator('button:has-text("Refresh")').click()
    await expect(main.locator('.audit-table tbody')).toContainText('refreshed-user', {
      timeout: 5000,
    })
  })
})
