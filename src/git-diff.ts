import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { getBaseDir } from './base-dir'
import { getCollectionsDir, getDecksDir, getWantedDir } from './ritual-config'

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
 * Return the list of file changes between `commit` and HEAD, filtered to
 * list files (decks/, collections/, wanted/) only.
 *
 * Uses `-M` to enable rename detection.
 */
export function getChangedFiles(commit: string, cwd: string): FileChange[] {
  const raw = execFileSync('git', ['diff', '--name-status', '-M', commit, 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanGitEnv(),
  })

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
 * Returns `null` if the file didn't exist at that commit.
 */
export function getFileAtCommit(commit: string, filePath: string, cwd: string): string | null {
  try {
    return execFileSync('git', ['show', `${commit}:${filePath}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanGitEnv(),
    })
  } catch {
    return null
  }
}
