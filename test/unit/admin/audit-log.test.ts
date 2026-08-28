import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { appendAuditLog, createAuditEntry, readAuditLog } from '../../../src/admin/audit-log'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'

let ws: BoundWorkspace

describe('audit log', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('createAuditEntry creates a well-formed entry', () => {
    const entry = createAuditEntry('1.2.3.4', 'admin', true, 'Login successful', 'Mozilla/5.0')
    expect(entry.ip).toBe('1.2.3.4')
    expect(entry.username).toBe('admin')
    expect(entry.success).toBe(true)
    expect(entry.reason).toBe('Login successful')
    expect(entry.userAgent).toBe('Mozilla/5.0')
    expect(entry.timestamp).toBeString()
  })

  test('appendAuditLog and readAuditLog round-trip', async () => {
    const entry1 = createAuditEntry('1.2.3.4', 'admin', true, 'Login successful', 'Agent')
    const entry2 = createAuditEntry('5.6.7.8', 'admin', false, 'Invalid credentials', 'Bot')

    await appendAuditLog(entry1)
    await appendAuditLog(entry2)

    const entries = await readAuditLog()
    expect(entries.length).toBe(2)
    // Most recent first
    expect(entries[0]!.ip).toBe('5.6.7.8')
    expect(entries[1]!.ip).toBe('1.2.3.4')
  })

  test('readAuditLog returns empty array when no log exists', async () => {
    const entries = await readAuditLog()
    expect(entries).toEqual([])
  })

  test('readAuditLog respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendAuditLog(createAuditEntry(`10.0.0.${i}`, 'admin', true, 'ok', 'Agent'))
    }
    const entries = await readAuditLog(3)
    expect(entries.length).toBe(3)
  })
})
