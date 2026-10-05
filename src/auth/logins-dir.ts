import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../config/base-dir'
import { writeFileAtomic } from '../util/atomic-write'

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

/**
 * Write `value` as JSON to `filePath` under `.logins/`, creating the private
 * directory if needed. The file is readable by its owner only (`0600`) from
 * the moment it exists, even when it replaces a wider one.
 */
export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await ensureLoginsDir()
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
