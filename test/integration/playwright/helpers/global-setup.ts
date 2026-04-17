import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PID_FILE = path.join(__dirname, '.server-pids.json')

type ServerPids = {
  serve?: number
  admin?: number
}

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

async function globalSetup() {
  const cwd = path.resolve(__dirname, '../../../..')

  // Always rebuild the site to ensure latest code is served
  console.log('[global-setup] Building site...')
  execSync('bun run index.ts build-site --yes', { cwd, stdio: 'pipe', timeout: 300_000 })
  console.log('[global-setup] Site built.')

  // Clean up any previous admin auth state so setup flow works
  const loginsDir = path.join(cwd, '.logins')
  const authFile = path.join(loginsDir, 'admin-auth.json')
  if (fs.existsSync(authFile)) {
    fs.unlinkSync(authFile)
  }

  // Kill any leftover servers on our ports
  killPort(3456)
  killPort(8456)
  // Brief pause to let ports release
  await new Promise((r) => setTimeout(r, 500))

  // Start the serve command (public site)
  console.log('[global-setup] Starting public site server on :3456...')
  const serveProc = spawn('bun', ['run', 'index.ts', 'serve', '--port', '3456'], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    detached: true,
    env: { ...process.env, PATH: process.env.PATH },
  })
  serveProc.unref()

  // Start the admin command
  console.log('[global-setup] Starting admin server on :8456...')
  const adminProc = spawn('bun', ['run', 'index.ts', 'admin', '--port', '8456'], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    detached: true,
    env: { ...process.env, PATH: process.env.PATH },
  })
  adminProc.unref()

  const pids: ServerPids = {
    serve: serveProc.pid,
    admin: adminProc.pid,
  }
  fs.writeFileSync(PID_FILE, JSON.stringify(pids))

  // Wait for both servers to be ready (admin takes longer due to SPA build)
  console.log('[global-setup] Waiting for servers...')
  await Promise.all([
    waitForServer('http://localhost:3456', 30_000),
    waitForServer('http://localhost:8456/api/status', 120_000),
  ])
  console.log('[global-setup] All servers ready.')
}

export default globalSetup
