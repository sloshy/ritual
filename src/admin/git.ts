import { execSync } from 'node:child_process'
import path from 'node:path'
import type { RitualConfig } from '../ritual-config'
import { getBaseDir } from '../base-dir'

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

export function shouldAutoCommit(config: RitualConfig, dir: string): boolean {
  return config.admin.gitEnabled && config.admin.gitAutoCommit && isGitRepo(dir)
}

export function shouldAutoPush(config: RitualConfig, dir: string): boolean {
  return config.admin.gitEnabled && config.admin.gitAutoPush && isGitRepo(dir)
}
