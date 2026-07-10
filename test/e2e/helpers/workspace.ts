import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Shared state written by global-setup and read by teardown and specs. */
export type E2eState = {
  /** Absolute path of the synthetic temp workspace the servers run against. */
  workspaceDir: string
  /** PID of the `ritual serve` process. */
  servePid?: number
  /** PID of the `ritual admin` process. */
  adminPid?: number
}

/** Where the e2e run state lives (gitignored; removed by global-teardown). */
export const E2E_STATE_FILE = path.join(__dirname, '.e2e-state.json')

export function writeE2eState(state: E2eState): void {
  fs.writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2))
}

/** Terminate a detached e2e server process (and its process group) if still alive. */
export function killProcess(pid: number): void {
  try {
    // Kill the process group (negative PID) since we used detached: true
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process already gone
    }
  }
}

export function readE2eState(): E2eState | null {
  if (!fs.existsSync(E2E_STATE_FILE)) return null
  return JSON.parse(fs.readFileSync(E2E_STATE_FILE, 'utf-8')) as E2eState
}

/**
 * The admin server's stored-credentials file inside the synthetic workspace.
 * Deleting it returns the server to the "create your admin account" setup flow.
 */
export function getAdminAuthFile(): string {
  const state = readE2eState()
  if (!state) {
    throw new Error(
      'e2e state file missing — global-setup must run before specs (did you bypass the Playwright config?)',
    )
  }
  return path.join(state.workspaceDir, '.logins', 'admin-auth.json')
}
