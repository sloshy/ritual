import { test, expect } from '@playwright/test'
import { loginAsAdmin } from '../helpers/auth-helper'
import { mockChangeHistoryApi } from '../helpers/mock-data'

type SaveBody = { sets: { timestamp: string; lines: string[] }[] }

test.describe('Change History page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  async function openDeckHistory(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('.admin-nav-item:has-text("Change History")').click()
    await expect(page.locator('.section-heading')).toContainText('Change History')
    await page.locator('#history-list-select').selectOption('deck:history-deck')
    await expect(page.locator('.history-set')).toHaveCount(2)
  }

  test('deletes a change set, then undo restores it', async ({ page }) => {
    await mockChangeHistoryApi(page)
    await openDeckHistory(page)

    // Delete the older set; one row remains and the summary reflects 2 → 1.
    await page
      .locator('.history-set', { hasText: '2026-01-01' })
      .locator('button:has-text("Delete")')
      .click()
    await expect(page.locator('.history-set')).toHaveCount(1)
    await expect(page.locator('.history-set')).toContainText('2026-02-01')
    await expect(page.locator('.history-summary')).toContainText('2 → 1')

    // Undo brings the deleted set back.
    await page.locator('.btn-changes:has-text("Undo")').click()
    await expect(page.locator('.history-set')).toHaveCount(2)
  })

  test('saves the edited history to the changelog', async ({ page }) => {
    let saved: SaveBody | null = null
    await mockChangeHistoryApi(page, (body) => {
      saved = body as SaveBody
    })
    await openDeckHistory(page)

    await page
      .locator('.history-set', { hasText: '2026-01-01' })
      .locator('button:has-text("Delete")')
      .click()
    await page.locator('.btn-save').click()

    await expect.poll(() => saved).not.toBeNull()
    expect(saved!.sets).toHaveLength(1)
    expect(saved!.sets[0]!.timestamp).toBe('2026-02-01T00:00:00.000Z')
  })

  test('combines one change set into another', async ({ page }) => {
    await mockChangeHistoryApi(page)
    await openDeckHistory(page)

    // Combine into the 2026-02-01 set; it absorbs the 2026-01-01 set's entries.
    await page
      .locator('.history-set', { hasText: '2026-02-01' })
      .locator('button:has-text("Combine")')
      .click()
    await page.locator('.history-combine-option', { hasText: '2026-01-01' }).click()

    const remaining = page.locator('.history-set')
    await expect(remaining).toHaveCount(1)
    await expect(remaining).toContainText('2026-02-01')
    await expect(remaining).toContainText('2 changes')

    // Expanding shows both merged change lines, ordered oldest-set-first: the
    // 2026-01-01 "Sol Ring" entry sits above the newer 2026-02-01 "Mana Crypt".
    await remaining.locator('.history-set-main').click()
    const lines = remaining.locator('.history-line')
    await expect(lines).toHaveCount(2)
    await expect(lines.nth(0)).toContainText('Sol Ring')
    await expect(lines.nth(1)).toContainText('Mana Crypt')
  })

  test('rewrites history with defaults', async ({ page }) => {
    let saved: SaveBody | null = null
    await mockChangeHistoryApi(page, (body) => {
      saved = body as SaveBody
    })
    await openDeckHistory(page)

    await page.locator('.btn-defaults:has-text("Rewrite with defaults")').click()
    await page.locator('.confirm-dialog button:has-text("Rewrite")').click()

    // A single set replaces the two, holding the two default change lines.
    await expect(page.locator('.history-set')).toHaveCount(1)
    await expect(page.locator('.history-set')).toContainText('2 changes')

    await page.locator('.btn-save').click()
    await expect.poll(() => saved).not.toBeNull()
    expect(saved!.sets).toHaveLength(1)
    expect(saved!.sets[0]!.lines).toHaveLength(2)
    // The rewritten set is stamped "now" — a well-formed ISO-8601 timestamp.
    expect(saved!.sets[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  test('edits a change set timestamp and re-sorts', async ({ page }) => {
    await mockChangeHistoryApi(page)
    await openDeckHistory(page)

    await page
      .locator('.history-set', { hasText: '2026-01-01' })
      .locator('button:has-text("Edit time")')
      .click()
    await page.locator('#text-prompt-input').fill('2026-03-01T00:00:00.000Z')
    await page.locator('.text-prompt button:has-text("Update")').click()

    // The retimed set sorts to the top (newest first).
    await expect(page.locator('.history-set').first()).toContainText('2026-03-01')
  })
})
