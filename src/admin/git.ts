import { execSync } from 'node:child_process'
import path from 'node:path'
import type { RitualConfig } from '../config/ritual-config'
import { getBaseDir } from '../config/base-dir'

export function isGitRepo(dir: string): boolean {
  try {
    // GIT_DIR and GIT_WORK_TREE must be cleared so the check is relative to
    // `dir` and not inherited from an ambient git environment (e.g. a commit hook).
    const { GIT_DIR: _gitDir, GIT_WORK_TREE: _gitWorkTree, ...env } = process.env
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      env,
    })
    return true
  } catch {
    return false
  }
}

export function commitFiles(files: string[], message: string, cwd?: string): void {
  const workDir = cwd ?? getBaseDir()
  const relativePaths = files.map((f) => path.relative(workDir, f))

  for (const file of relativePaths) {
    execSync(`git add ${JSON.stringify(file)}`, {
      cwd: workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  execSync(`git commit -m ${JSON.stringify(message)}`, {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export function pushChanges(cwd?: string): void {
  const workDir = cwd ?? getBaseDir()
  execSync('git push', {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/**
 * When set, {@link shouldAutoCommit} and {@link shouldAutoPush} both report
 * false regardless of the `admin.git*` config keys. See {@link suppressAutoCommit}.
 */
let autoCommitSuppressed = false

/**
 * Run `fn` with git auto-commit and auto-push disabled, regardless of the
 * `admin.git*` config keys. Those keys govern the admin surfaces — the admin
 * web UI and the MCP server (which reuses the admin handlers) — while CLI
 * commands never auto-commit. A CLI command that replays admin save handlers
 * in-process (`ritual import-changes`) wraps the apply in this so the shared
 * handlers stay commit-free on the CLI path. The suppression is restored even
 * when `fn` throws.
 */
export async function suppressAutoCommit<T>(fn: () => Promise<T>): Promise<T> {
  autoCommitSuppressed = true
  try {
    return await fn()
  } finally {
    autoCommitSuppressed = false
  }
}

export function shouldAutoCommit(config: RitualConfig, dir: string): boolean {
  if (autoCommitSuppressed) return false
  return config.admin.gitEnabled && config.admin.gitAutoCommit && isGitRepo(dir)
}

export function shouldAutoPush(config: RitualConfig, dir: string): boolean {
  if (autoCommitSuppressed) return false
  return config.admin.gitEnabled && config.admin.gitAutoPush && isGitRepo(dir)
}
