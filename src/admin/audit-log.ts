import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureLoginsDir, getLoginsDir } from '../auth/logins-dir'

export interface AuditEntry {
  timestamp: string
  ip: string
  username: string
  success: boolean
  reason: string
  userAgent: string
}

function getAuditLogPath(): string {
  return path.join(getLoginsDir(), 'admin-audit.log')
}

export async function appendAuditLog(entry: AuditEntry): Promise<void> {
  await ensureLoginsDir()
  const line = JSON.stringify(entry) + '\n'
  await fs.appendFile(getAuditLogPath(), line, { mode: 0o600 })
}

export function createAuditEntry(
  ip: string,
  username: string,
  success: boolean,
  reason: string,
  userAgent: string,
): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    ip,
    username,
    success,
    reason,
    userAgent,
  }
}

export async function readAuditLog(limit = 100): Promise<AuditEntry[]> {
  try {
    const content = await fs.readFile(getAuditLogPath(), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry
        } catch {
          return null
        }
      })
      .filter((e): e is AuditEntry => e !== null)
    // Return most recent first, limited
    return entries.slice(-limit).reverse()
  } catch {
    return []
  }
}
