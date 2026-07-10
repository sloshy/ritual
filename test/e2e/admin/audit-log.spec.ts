import { test, expect } from '@playwright/test'
import { gotoAdminDashboard } from '../helpers/auth-helper'
import { fulfillJson } from '../helpers/fulfill'
import { mockAuditLogApi, MOCK_AUDIT_ENTRIES } from '../helpers/mock-admin'

test.describe('Audit Log Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuditLogApi(page)
    await gotoAdminDashboard(page)
    await page.locator('.admin-sidebar .admin-nav-item:has-text("Audit Log")').click()
    await expect(page.locator('.section-heading')).toContainText('Audit Log')
  })

  test('refresh button fetches updated data and re-renders the table', async ({ page }) => {
    const updatedEntry = {
      ...MOCK_AUDIT_ENTRIES[0],
      username: 'refreshed-user',
      timestamp: new Date().toISOString(),
    }
    await fulfillJson(page, '**/api/audit-log*', { success: true, entries: [updatedEntry] })
    const main = page.locator('main')
    await main.locator('button:has-text("Refresh")').click()
    await expect(main.locator('.audit-table tbody')).toContainText('refreshed-user', {
      timeout: 5000,
    })
  })
})
