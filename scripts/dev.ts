#!/usr/bin/env bun
/**
 * Source-tree dev orchestrator. Spawns `bun index.ts <subcommand> [...args]`
 * as a child, watches source files (and data files for `serve`), and
 * fully restarts the child on changes so core-logic edits take effect.
 *
 * Only meant to run from the project root via `bun run dev`.
 */
import path from 'node:path'
import { existsSync, watch } from 'node:fs'
import { answerFlagRequiredMessage, hasAnswerFlag } from './dev-args'
import { shouldRestartForSource } from './dev-watch'
import { diffSnapshots, snapshotTree, type TreeSnapshot, type WatchRoot } from './dev-snapshot'

const SUBCOMMANDS = ['admin', 'serve'] as const
type Subcommand = (typeof SUBCOMMANDS)[number]

// Subcommands whose underlying command can issue interactive prompts (the
// Scryfall cache refresh under the default `--refresh ask`). The child can't
// read stdin under the orchestrator, so these require an explicit non-`ask`
// `--refresh <mode>` (or `--no-input`) up front.
const PROMPTING_SUBCOMMANDS: readonly Subcommand[] = ['admin', 'serve']

const DATA_DIRS: readonly string[] = ['decks', 'collections', 'wanted']
const RESTART_DEBOUNCE_MS = 200
const SHUTDOWN_GRACE_MS = 1_500
// How often the snapshot backstop re-scans the watched tree for changes that
// `fs.watch` dropped. ~260 files to stat per tick is sub-millisecond.
const RECONCILE_INTERVAL_MS = 1_000

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

// Under the orchestrator, `serve` always builds — a watch-and-restart loop
// over a command that never rebuilds would be pointless. Append `--build`
// unless the caller already passed it.
if (subcommand === 'serve' && !passthrough.includes('--build')) {
  passthrough.push('--build')
}

// The orchestrator owns the TTY, so the child can't answer interactive
// prompts. Require the prompt answers up front and bail before spawning.
if (PROMPTING_SUBCOMMANDS.includes(subcommand) && !hasAnswerFlag(passthrough)) {
  console.error(answerFlagRequiredMessage(subcommand))
  process.exit(1)
}

const projectRoot = path.join(import.meta.dir, '..')
const indexPath = path.join(projectRoot, 'index.ts')
const srcDir = path.join(projectRoot, 'src')

// Directories whose changes restart the child, each paired with the predicate
// that decides which files count. The same set drives both the `fs.watch` fast
// path and the snapshot-reconciliation backstop, so the two can never disagree
// about what counts as "watched".
const watchRoots: WatchRoot[] = buildWatchRoots()

function buildWatchRoots(): WatchRoot[] {
  const roots: WatchRoot[] = [{ dir: srcDir, include: shouldRestartForSource }]
  if (subcommand === 'serve') {
    const baseDir = resolveBaseDir()
    for (const dataDir of DATA_DIRS) {
      const abs = path.join(baseDir, dataDir)
      if (existsSync(abs)) roots.push({ dir: abs, include: (f) => f.endsWith('.md') })
    }
  }
  return roots
}

type ChildProc = ReturnType<typeof Bun.spawn>
let child: ChildProc | null = null
let restartTimer: ReturnType<typeof setTimeout> | null = null
let shuttingDown = false

// Restarts are serialized: at most one restart cycle runs at a time. A change
// that arrives mid-cycle sets `restartQueued` so the cycle loops once more to
// pick up the latest edits, rather than spawning a second, competing restart
// that could orphan a child still holding the dev port.
let restarting = false
let restartQueued = false

// The watched-tree state the currently-running build was launched against. The
// reconciliation backstop diffs against this to catch any change `fs.watch`
// missed since the build began.
let builtSnapshot: TreeSnapshot = new Map()

// Procs we've deliberately signalled (for a restart or a shutdown). Their exit
// is expected, so `onExit` must not mistake it for a crash and tear the whole
// orchestrator down.
const expectedExits = new WeakSet<ChildProc>()

function relativeFromRoot(p: string): string {
  return path.relative(projectRoot, p) || p
}

function spawnChild(): void {
  // Snapshot the watched tree the instant we (re)launch the build. Anything that
  // changes after this is drift the reconciliation backstop will rebuild for.
  builtSnapshot = snapshotTree(watchRoots)
  const argline = [subcommand, ...passthrough].join(' ')
  console.log(`[dev] Starting: bun ${relativeFromRoot(indexPath)} ${argline}`)
  // - `detached: true` puts the child in its own process group so terminal
  //   signals reach only the orchestrator. The orchestrator owns the child's
  //   lifecycle and signals it explicitly.
  // - `stdio[0] = 'ignore'` gives the orchestrator exclusive ownership of the
  //   TTY for keyboard-shortcut detection. The child therefore can't read
  //   interactive prompts, which is why the prompting subcommands require an
  //   explicit non-`ask` `--refresh <mode>` or `--no-input` (enforced above)
  //   that the child resolves non-interactively.
  child = Bun.spawn(['bun', indexPath, subcommand, ...passthrough], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    onExit(proc, code, signal) {
      // An exit we asked for (restart or shutdown) is expected; ignore it.
      if (shuttingDown || expectedExits.has(proc)) return
      // An unexpected exit is almost always a compile error crashing the build.
      // Keep the orchestrator and its file watchers alive and just drop the dead
      // child, so the next source change respawns it. Tearing the whole dev
      // session down on a typo would force a manual restart after every error.
      if (signal) console.log(`[dev] Child exited (signal=${signal}).`)
      else console.log(`[dev] Child exited (code=${code ?? 0}).`)
      // Guard against a restart having already replaced the reference.
      if (child === proc) child = null
      console.log('[dev] Waiting for changes before retrying...')
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
  expectedExits.add(proc)
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
  // A restart is already running: coalesce this request into it and return.
  // The in-flight cycle loops once more (below) to pick up the latest change,
  // so overlapping file events never spawn competing restarts.
  if (restarting) {
    restartQueued = true
    return
  }
  restarting = true
  try {
    do {
      restartQueued = false
      if (shuttingDown) return
      if (child) {
        console.log('[dev] Restarting...')
        await killChildAndWait(child, 'SIGTERM')
        child = null
      }
      if (shuttingDown) return
      spawnChild()
    } while (restartQueued && !shuttingDown)
  } finally {
    restarting = false
  }
}

function scheduleRestart(reason: string): void {
  if (restartTimer) clearTimeout(restartTimer)
  console.log(`[dev] Change: ${reason}`)
  restartTimer = setTimeout(() => {
    restartTimer = null
    void restart()
  }, RESTART_DEBOUNCE_MS)
}

function resolveBaseDir(): string {
  const idx = passthrough.indexOf('--base-dir')
  if (idx >= 0 && idx + 1 < passthrough.length) {
    return path.resolve(passthrough[idx + 1]!)
  }
  return projectRoot
}

// Fast path: react to filesystem events immediately.
for (const root of watchRoots) {
  watch(root.dir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const relative = filename.split(path.sep).join('/')
    if (!root.include(relative)) return
    scheduleRestart(relativeFromRoot(path.join(root.dir, filename)))
  })
  console.log(`[dev] Watching ${relativeFromRoot(root.dir)}`)
}

// Backstop: `fs.watch` silently drops events under bursts (formatters, save-all,
// atomic-rename saves), which would leave the build stale. Periodically diff the
// watched tree against the snapshot the running build was launched from and
// restart on any drift, so the build always converges on the latest sources.
function reconcile(): void {
  if (shuttingDown) return
  // A restart is already pending or in flight; it will refresh `builtSnapshot`.
  // Skip so we don't queue redundant work — the next tick re-checks once settled.
  if (restarting || restartTimer) return
  const changed = diffSnapshots(builtSnapshot, snapshotTree(watchRoots))
  if (changed.length === 0) return
  const names = changed.map(relativeFromRoot)
  const shown = names.slice(0, 3).join(', ')
  const summary = names.length > 3 ? `${shown} +${names.length - 3} more` : shown
  scheduleRestart(`reconcile (${summary})`)
}

let reconcileTimer: ReturnType<typeof setInterval> | null = setInterval(
  reconcile,
  RECONCILE_INTERVAL_MS,
)

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
  if (reconcileTimer) {
    clearInterval(reconcileTimer)
    reconcileTimer = null
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
