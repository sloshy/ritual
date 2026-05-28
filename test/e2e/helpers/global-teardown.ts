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

function killProcess(pid: number) {
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

async function globalTeardown() {
  if (!fs.existsSync(PID_FILE)) return

  const pids: ServerPids = JSON.parse(fs.readFileSync(PID_FILE, 'utf-8'))

  if (pids.serve) {
    console.log(`[global-teardown] Stopping public site server (PID ${pids.serve})`)
    killProcess(pids.serve)
  }
  if (pids.admin) {
    console.log(`[global-teardown] Stopping admin server (PID ${pids.admin})`)
    killProcess(pids.admin)
  }

  fs.unlinkSync(PID_FILE)
  console.log('[global-teardown] Servers stopped.')
}

export default globalTeardown
