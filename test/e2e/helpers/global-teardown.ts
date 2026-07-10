import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { E2E_STATE_FILE, killProcess, readE2eState } from './workspace'

async function globalTeardown(): Promise<void> {
  const state = readE2eState()
  if (!state) return

  if (state.servePid) {
    console.log(`[global-teardown] Stopping public site server (PID ${state.servePid})`)
    killProcess(state.servePid)
  }
  if (state.adminPid) {
    console.log(`[global-teardown] Stopping admin server (PID ${state.adminPid})`)
    killProcess(state.adminPid)
  }

  // Remove the synthetic workspace. Guard against a corrupt state file ever
  // pointing the recursive delete somewhere unexpected.
  if (state.workspaceDir && state.workspaceDir.startsWith(path.join(os.tmpdir(), 'ritual-e2e-'))) {
    fs.rmSync(state.workspaceDir, { recursive: true, force: true })
    console.log(`[global-teardown] Removed workspace ${state.workspaceDir}`)
  }

  fs.unlinkSync(E2E_STATE_FILE)
  console.log('[global-teardown] Servers stopped.')
}

export default globalTeardown
