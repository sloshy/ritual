import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from './base-dir'

export function getLoginsDir(): string {
  return path.join(getBaseDir(), '.logins')
}

export async function ensureLoginsDir(): Promise<void> {
  const loginsDir = getLoginsDir()
  try {
    await fs.access(loginsDir)
  } catch {
    await fs.mkdir(loginsDir, { recursive: true, mode: 0o700 })
  }
}
