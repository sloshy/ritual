import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSyntheticWorkspace } from './synthetic-workspace'
import { killProcess, writeE2eState } from './workspace'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      fetch(url)
        .then((res) => {
          if (res.ok || res.status < 500) resolve()
          else if (Date.now() - start > timeoutMs) reject(new Error(`Server at ${url} not ready`))
          else setTimeout(check, 500)
        })
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error(`Server at ${url} not ready`))
          else setTimeout(check, 500)
        })
    }
    check()
  })
}

function killPort(port: number): void {
  try {
    const pid = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (pid) {
      for (const p of pid.split('\n')) {
        try {
          process.kill(parseInt(p, 10), 'SIGKILL')
        } catch {
          // already dead
        }
      }
    }
  } catch {
    // no process on port
  }
}

async function globalSetup(): Promise<void> {
  // From test/e2e/helpers/ → repo root is three levels up. Only the ritual
  // sources are run from here — all data the servers touch lives in a
  // synthetic temp workspace so specs never see (or mutate) real lists and
  // the build never needs the network.
  const repoRoot = path.resolve(__dirname, '../../..')

  console.log('[global-setup] Creating synthetic workspace...')
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ritual-e2e-'))
  createSyntheticWorkspace(workspaceDir)
  console.log(`[global-setup] Workspace at ${workspaceDir}`)

  // Build the site from the synthetic workspace. --refresh never guarantees
  // the build uses the seeded cache as-is and never contacts Scryfall.
  console.log('[global-setup] Building site...')
  execSync(`bun run index.ts --base-dir "${workspaceDir}" build-site --refresh never`, {
    cwd: repoRoot,
    stdio: 'pipe',
    timeout: 300_000,
  })
  console.log('[global-setup] Site built.')

  // Kill any leftover servers on our ports
  killPort(3456)
  killPort(8456)
  // Brief pause to let ports release
  await new Promise((r) => setTimeout(r, 500))

  // Start the serve command (public site)
  console.log('[global-setup] Starting public site server on :3456...')
  const serveProc = spawn(
    'bun',
    ['run', 'index.ts', '--base-dir', workspaceDir, 'serve', '--port', '3456'],
    {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: true,
      env: { ...process.env, PATH: process.env.PATH },
    },
  )
  serveProc.unref()

  // Start the admin command. The fresh workspace has no .logins, so the user
  // store starts empty and auth-setup.spec.ts can exercise the setup flow.
  // `--sell-mode` because the synthetic config does not enable it and sell mode
  // is off by default: without the flag the sell routes 404 and the editors'
  // sell surfaces (and the Refresh Cache page's buylist card) never render.
  console.log('[global-setup] Starting admin server on :8456...')
  const adminProc = spawn(
    'bun',
    [
      'run',
      'index.ts',
      '--base-dir',
      workspaceDir,
      'admin',
      '--port',
      '8456',
      '--refresh',
      'never',
      '--sell-mode',
    ],
    {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: true,
      env: { ...process.env, PATH: process.env.PATH },
    },
  )
  adminProc.unref()

  writeE2eState({
    workspaceDir,
    servePid: serveProc.pid,
    adminPid: adminProc.pid,
  })

  // Wait for both servers to be ready (admin takes longer due to SPA build).
  // If either never comes up, kill both detached processes before rethrowing
  // so a failed setup doesn't leak servers holding the ports.
  console.log('[global-setup] Waiting for servers...')
  try {
    await Promise.all([
      waitForServer('http://localhost:3456', 30_000),
      waitForServer('http://localhost:8456/api/status', 120_000),
    ])
  } catch (error) {
    if (serveProc.pid !== undefined) killProcess(serveProc.pid)
    if (adminProc.pid !== undefined) killProcess(adminProc.pid)
    throw error
  }
  console.log('[global-setup] All servers ready.')
}

export default globalSetup
