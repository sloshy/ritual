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
  child = Bun.spawn(['bun', indexPath, subcommand, ...passthrough], {
    cwd: projectRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    onExit(_proc, code, signal) {
      if (restartingByDevScript) return
      if (signal) console.log(`[dev] Child exited (signal=${signal}).`)
      else console.log(`[dev] Child exited (code=${code ?? 0}).`)
      process.exit(code ?? 0)
    },
  })
}

async function restart(): Promise<void> {
  if (shuttingDown) return
  if (!child) {
    spawnChild()
    return
  }
  restartingByDevScript = true
  console.log('[dev] Restarting...')
  child.kill('SIGTERM')
  await child.exited
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
function shutdown(signal: ShutdownSignal): void {
  shuttingDown = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (child) child.kill(signal)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

spawnChild()
