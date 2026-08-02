import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { getBaseDir } from './base-dir'
import { getCollectionsDir, getDecksDir, getWantedDir } from './ritual-config'
import { hasErrorCode } from './errors'

// ── Types ────────────────────────────────────────────────────────────

export type FileChangeStatus = 'A' | 'M' | 'D' | 'R'

export type FileChange = {
  status: FileChangeStatus
  /** For renames this is the old path; for other statuses it equals `path`. */
  oldPath: string
  /** The current (new) path of the file. */
  path: string
}

export type ListKind = 'deck' | 'collection' | 'wanted'

// ── Helpers ──────────────────────────────────────────────────────────

function isListFile(filePath: string): boolean {
  return (
    filePath.endsWith('.md') &&
    !filePath.endsWith('.changes.md') &&
    !filePath.endsWith('.primer.md')
  )
}

function relativePrefix(absDir: string): string {
  const rel = path.relative(getBaseDir(), absDir)
  return rel === '' ? '' : rel + path.sep
}

export function classifyFile(filePath: string): ListKind | null {
  if (!isListFile(filePath)) return null
  const normalized = filePath.split(path.sep).join('/')
  const matchPrefix = (absDir: string): string => {
    const prefix = relativePrefix(absDir).split(path.sep).join('/')
    return prefix
  }
  const decksPrefix = matchPrefix(getDecksDir())
  const collectionsPrefix = matchPrefix(getCollectionsDir())
  const wantedPrefix = matchPrefix(getWantedDir())
  if (decksPrefix && normalized.startsWith(decksPrefix)) return 'deck'
  if (collectionsPrefix && normalized.startsWith(collectionsPrefix)) return 'collection'
  if (wantedPrefix && normalized.startsWith(wantedPrefix)) return 'wanted'
  return null
}

export function changesPath(listFilePath: string): string {
  return listFilePath.replace(/\.md$/, '.changes.md')
}

// ── Git operations ───────────────────────────────────────────────────

export function cleanGitEnv(): Record<string, string | undefined> {
  const { GIT_DIR: _d, GIT_WORK_TREE: _w, ...env } = process.env
  return env
}

/**
 * A failed `git` subprocess, wrapped with what Ritual was trying to do. Raw git
 * stderr alone ("error: Could not access 'HEAD~1'") never says which Ritual
 * operation failed or on what, so callers report {@link message} first and keep
 * {@link gitDetail} as a secondary line.
 */
export class GitCommandError extends Error {
  readonly gitDetail: string | null

  constructor(message: string, gitDetail: string | null) {
    super(message)
    this.name = 'GitCommandError'
    this.gitDetail = gitDetail
  }
}

/** The first meaningful stderr line of a failed `execFileSync`, if any. */
export function gitStderrSummary(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return null
  const stderr: unknown = error.stderr
  const text =
    typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString() : ''
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return line ?? null
}

/**
 * Run `git` and return its stdout, converting any failure into a
 * {@link GitCommandError} carrying `operation` as the human-facing message.
 */
function runGit(args: readonly string[], cwd: string, operation: string): string {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanGitEnv(),
    })
  } catch (error) {
    // A spawn failure produces no stderr at all, so name the one cause worth
    // naming; every other silent failure stays `null` (a probe reads that as
    // git's own quiet "no").
    const spawnFailure = hasErrorCode(error, 'ENOENT')
      ? 'git is not installed or not on PATH'
      : null
    throw new GitCommandError(operation, gitStderrSummary(error) ?? spawnFailure)
  }
}

/**
 * The outcome of a yes/no git probe. `ok: false` means git itself could not
 * answer (not installed, refused the repository, a broken object store) — a
 * different situation from a confident `present: false`, and one the caller
 * must report rather than reinterpret as "the thing is not there".
 */
export type GitProbeResult = { ok: true; present: boolean } | { ok: false; error: GitCommandError }

/** git's own wording when `cwd` simply is not inside a working tree. */
const NOT_A_REPO_PATTERN = /^fatal: not a git repository/i

/**
 * Whether `cwd` is inside a git working tree.
 *
 * Only git's own "not a git repository" is reported as `present: false`;
 * anything else (git missing from PATH, `detected dubious ownership`, a
 * corrupt object store) surfaces as a failure so the caller does not steer the
 * user toward a workaround for a problem they do not have.
 */
export function probeGitRepository(cwd: string): GitProbeResult {
  try {
    runGit(['rev-parse', '--git-dir'], cwd, `Failed to check whether ${cwd} is a git repository`)
    return { ok: true, present: true }
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error
    if (error.gitDetail !== null && NOT_A_REPO_PATTERN.test(error.gitDetail)) {
      return { ok: true, present: false }
    }
    return { ok: false, error }
  }
}

/**
 * Whether `commit` resolves to a commit in the repository at `cwd`.
 *
 * `--quiet` makes git exit nonzero *silently* for an unresolvable ref, so an
 * empty stderr is the "no such ref" answer and anything git did say is a real
 * failure.
 */
export function probeGitRef(commit: string, cwd: string): GitProbeResult {
  try {
    runGit(
      ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`],
      cwd,
      `Failed to resolve "${commit}" in ${cwd}`,
    )
    return { ok: true, present: true }
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error
    if (error.gitDetail === null) return { ok: true, present: false }
    return { ok: false, error }
  }
}

/**
 * Return the list of file changes between `commit` and HEAD, filtered to
 * list files (decks/, collections/, wanted/) only.
 *
 * Uses `-M` to enable rename detection.
 */
export function getChangedFiles(commit: string, cwd: string): FileChange[] {
  const raw = runGit(
    ['diff', '--name-status', '-M', commit, 'HEAD'],
    cwd,
    `Failed to read the git diff between ${commit} and HEAD in ${cwd}`,
  )

  return parseNameStatus(raw)
}

/**
 * Parse the raw output of `git diff --name-status`.
 *
 * Each line is tab-separated: `<status>\t<path>` or `<Rnn>\t<old>\t<new>`.
 */
export function parseNameStatus(raw: string): FileChange[] {
  const results: FileChange[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const parts = trimmed.split('\t')
    const statusField = parts[0]
    if (!statusField) continue

    if (statusField.startsWith('R')) {
      const oldPath = parts[1]
      const newPath = parts[2]
      if (!oldPath || !newPath) continue
      if (!classifyFile(newPath) && !classifyFile(oldPath)) continue
      results.push({ status: 'R', oldPath, path: newPath })
    } else if (statusField === 'A' || statusField === 'M' || statusField === 'D') {
      const filePath = parts[1]
      if (!filePath) continue
      if (!classifyFile(filePath)) continue
      results.push({ status: statusField, oldPath: filePath, path: filePath })
    }
  }

  return results
}

/**
 * Retrieve the contents of a file at a specific git commit.
 *
 * Only call this for a path git's own diff says exists at `commit` (any status
 * but `A`). Absence is therefore impossible by contract, so every failure is a
 * real git failure and throws {@link GitCommandError} — returning `null` here
 * would let a transient git error masquerade as "the file did not exist yet",
 * which diffs as *every card added* and then stamps that fiction into the
 * `.sha256` sidecar.
 */
export function getFileAtCommit(commit: string, filePath: string, cwd: string): string {
  return runGit(
    ['show', `${commit}:${filePath}`],
    cwd,
    `Failed to read ${filePath} at ${commit} in ${cwd}`,
  )
}
