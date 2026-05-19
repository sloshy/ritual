#!/usr/bin/env bun
/**
 * Source-tree dev orchestrator. Spawns `bun index.ts <subcommand> [...args]`
 * as a child, watches source files (and data files for `serve-site`), and
 * fully restarts the child on changes so core-logic edits take effect.
 *
 * Only meant to run from the project root via `bun run dev`.
 */
import path from 'node:path'
import { existsSync, watch } from 'node:fs'

const SUBCOMMANDS = ['admin', 'serve-site'] as const
type Subcommand = (typeof SUBCOMMANDS)[number]

const DATA_DIRS: readonly string[] = ['decks', 'collections', 'wanted']
const RESTART_DEBOUNCE_MS = 200
const SHUTDOWN_GRACE_MS = 1_500

function isSubcommand(s: string): s is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(s)
}

const rawArgs = process.argv.slice(2)
const target = rawArgs[0]
if (!target || !isSubcommand(target)) {
  console.error(`Usage: bun run dev <${SUBCOMMANDS.join('|')}> [...args]`)
  process.exit(1)
}
const subcommand: Subcommand = target
const passthrough = rawArgs.slice(1)

const projectRoot = path.join(import.meta.dir, '..')
const indexPath = path.join(projectRoot, 'index.ts')
const srcDir = path.join(projectRoot, 'src')

type ChildProc = ReturnType<typeof Bun.spawn>
let child: ChildProc | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
let restartingByDevScript = false
let shuttingDown = false

function relativeFromRoot(p: string): string {
  return path.relative(projectRoot, p) || p
}

function spawnChild(): void {
  const argline = [subcommand, ...passthrough].join(' ')
  console.log(`[dev] Starting: bun ${relativeFromRoot(indexPath)} ${argline}`)
  // - `detached: true` puts the child in its own process group so terminal
  //   signals reach only the orchestrator. The orchestrator owns the child's
  //   lifecycle and signals it explicitly.
  // - `stdio[0] = 'ignore'` gives the orchestrator exclusive ownership of the
  //   TTY for keyboard-shortcut detection. The child's interactive prompts
  //   (e.g. `prompts` library) auto-default to their initial values since
  //   they detect non-TTY stdin.
  child = Bun.spawn(['bun', indexPath, subcommand, ...passthrough], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    onExit(_proc, code, signal) {
      if (restartingByDevScript || shuttingDown) return
      if (signal) console.log(`[dev] Child exited (signal=${signal}).`)
      else console.log(`[dev] Child exited (code=${code ?? 0}).`)
      void shutdown('SIGTERM')
    },
  })
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      /* already gone */
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killChildAndWait(proc: ChildProc, signal: ShutdownSignal): Promise<void> {
  const pid = proc.pid
  signalGroup(pid, signal)
  // Escalate to SIGKILL after a short grace period. SIGKILL is uncatchable,
  // so this guarantees the child dies even if Bun's runtime in the child is
  // catching SIGTERM/SIGINT without honoring them.
  const sigkill = setTimeout(() => signalGroup(pid, 'SIGKILL'), SHUTDOWN_GRACE_MS)
  try {
    await proc.exited
  } finally {
    clearTimeout(sigkill)
  }
  // Belt-and-suspenders: if for any reason the process is somehow still
  // alive after `exited` resolved, force-kill once more before we leave.
  if (isAlive(pid)) {
    signalGroup(pid, 'SIGKILL')
    for (let i = 0; i < 20 && isAlive(pid); i++) {
      await new Promise<void>((r) => setTimeout(r, 50))
    }
  }
}

async function restart(): Promise<void> {
  if (shuttingDown) return
  if (!child) {
    spawnChild()
    return
  }
  restartingByDevScript = true
  console.log('[dev] Restarting...')
  await killChildAndWait(child, 'SIGTERM')
  restartingByDevScript = false
  if (shuttingDown) return
  spawnChild()
}

function scheduleRestart(reason: string): void {
  if (restartTimer) clearTimeout(restartTimer)
  console.log(`[dev] Change: ${reason}`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    void restart()
  }, RESTART_DEBOUNCE_MS)
}

function isWatchedSource(filename: string): boolean {
  return (
    filename.endsWith('.ts') ||
    filename.endsWith('.tsx') ||
    filename.endsWith('.css') ||
    filename.endsWith('.svg')
  )
}

function resolveBaseDir(): string {
  const idx = passthrough.indexOf('--base-dir')
  if (idx >= 0 && idx + 1 < passthrough.length) {
    return path.resolve(passthrough[idx + 1]!)
  }
  return projectRoot
}

watch(srcDir, { recursive: true }, (_event, filename) => {
  if (!filename || !isWatchedSource(filename)) return
  scheduleRestart(`src/${filename}`)
})
console.log(`[dev] Watching ${relativeFromRoot(srcDir)}`)

if (subcommand === 'serve-site') {
  const baseDir = resolveBaseDir()
  for (const dataDir of DATA_DIRS) {
    const abs = path.join(baseDir, dataDir)
    if (!existsSync(abs)) continue
    watch(abs, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith('.md')) return
      scheduleRestart(`${dataDir}/${filename}`)
    })
    console.log(`[dev] Watching ${relativeFromRoot(abs)}`)
  }
}

type ShutdownSignal = 'SIGINT' | 'SIGTERM'
async function shutdown(signal: ShutdownSignal): Promise<void> {
  if (shuttingDown) {
    // Second signal: user is impatient — force-kill the child group and exit.
    if (child) signalGroup(child.pid, 'SIGKILL')
    restoreStdin()
    process.exit(0)
  }
  shuttingDown = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  console.log('\n[dev] Shutting down...')
  if (child) {
    await killChildAndWait(child, signal)
  }
  restoreStdin()
  process.exit(0)
}

const stdinIsTty = process.stdin.isTTY === true

function restoreStdin(): void {
  if (!stdinIsTty) return
  try {
    process.stdin.setRawMode(false)
  } catch {
    /* not a TTY anymore — ignore */
  }
  process.stdin.pause()
}

const CTRL_C = '\u0003'
const CTRL_D = '\u0004'

function setupKeyboardShortcuts(): void {
  if (!stdinIsTty) return
  try {
    process.stdin.setRawMode(true)
  } catch {
    return
  }
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    // Raw-mode bytes — one keystroke per chunk in typical use. Raw mode
    // disables the TTY's signal generation (ISIG), so Ctrl+C arrives here
    // as the literal \u0003 byte rather than as a SIGINT to the foreground
    // group — which is why shutdown can exit cleanly with code 0 without
    // `bun run` reporting a 130 signal-kill.
    if (chunk === 'q' || chunk === 'Q' || chunk === CTRL_C || chunk === CTRL_D) {
      void shutdown('SIGTERM')
    }
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGHUP', () => void shutdown('SIGTERM'))
// Defensive: if the process exits via any path (uncaught throw, etc.), make
// sure the user's terminal isn't left in raw mode.
process.on('exit', restoreStdin)

setupKeyboardShortcuts()
if (stdinIsTty) {
  console.log("[dev] Press 'q' or Ctrl+C to stop.")
}

spawnChild()
