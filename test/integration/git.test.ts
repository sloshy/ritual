import { describe, test, expect } from 'bun:test'
import {
  commitFiles,
  isGitRepo,
  shouldAutoCommit,
  shouldAutoPush,
  suppressAutoCommit,
} from '../../src/admin/git'
import { getDefaultRitualConfig } from '../../src/config/ritual-config'
import type { RitualConfig } from '../../src/config/ritual-config'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createWorkspace, initGitRepo, removeWorkspace } from '../helpers/workspace'

/** The commit/push gate values observed at one point in time. */
type GateSnapshot = { commit: boolean; push: boolean }

/** A config with every admin git key enabled, so only the suppression flag can gate. */
function allGitKeysEnabled(): RitualConfig {
  const base = getDefaultRitualConfig()
  return {
    ...base,
    admin: { ...base.admin, gitEnabled: true, gitAutoCommit: true, gitAutoPush: true },
  }
}

describe('admin git', () => {
  test('isGitRepo returns true for a directory inside a git repo', () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    expect(isGitRepo(projectRoot)).toBe(true)
  })

  test('isGitRepo returns false for a non-git directory', async () => {
    const tmpDir = await createWorkspace({ dirs: [], config: false })
    try {
      expect(isGitRepo(tmpDir)).toBe(false)
    } finally {
      await removeWorkspace(tmpDir)
    }
  })

  test('shouldAutoCommit requires both gitEnabled and gitAutoCommit in a repo', () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    const base = getDefaultRitualConfig()

    const cases: Array<{ gitEnabled: boolean; gitAutoCommit: boolean; expected: boolean }> = [
      { gitEnabled: true, gitAutoCommit: true, expected: true },
      { gitEnabled: false, gitAutoCommit: true, expected: false },
      { gitEnabled: true, gitAutoCommit: false, expected: false },
      { gitEnabled: false, gitAutoCommit: false, expected: false },
    ]

    for (const { gitEnabled, gitAutoCommit, expected } of cases) {
      const config: RitualConfig = { ...base, admin: { ...base.admin, gitEnabled, gitAutoCommit } }
      expect(shouldAutoCommit(config, projectRoot)).toBe(expected)
    }
  })

  test('suppressAutoCommit disables both gates inside the wrapped call and restores them after', async () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    const config = allGitKeysEnabled()

    expect(shouldAutoCommit(config, projectRoot)).toBe(true)
    expect(shouldAutoPush(config, projectRoot)).toBe(true)

    const inside = await suppressAutoCommit(async (): Promise<GateSnapshot> => ({
      commit: shouldAutoCommit(config, projectRoot),
      push: shouldAutoPush(config, projectRoot),
    }))
    expect(inside).toEqual({ commit: false, push: false })

    // Both gates come back once the wrapped call completes.
    expect(shouldAutoCommit(config, projectRoot)).toBe(true)
    expect(shouldAutoPush(config, projectRoot)).toBe(true)
  })

  test('suppressAutoCommit restores the gates even when the wrapped call throws', async () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    const config = allGitKeysEnabled()

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(
      suppressAutoCommit(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(shouldAutoCommit(config, projectRoot)).toBe(true)
    expect(shouldAutoPush(config, projectRoot)).toBe(true)
  })

  test('commitFiles passes the message and paths to git literally, never through a shell', async () => {
    const repo = await createWorkspace({ dirs: [], config: false })
    try {
      initGitRepo(repo)
      const git = (...args: string[]): string =>
        execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      // Something the user staged on their own, which the commit must leave alone.
      await fs.writeFile(path.join(repo, 'unrelated.md'), 'mine\n')
      git('add', 'unrelated.md')

      // A list name an attacker controls, as it lands in `Create deck: <name>`,
      // and a file whose name a shell would also have expanded.
      const message = 'Create deck: $(touch pwned) `touch pwned2` "quoted"'
      const file = path.join(repo, '$(touch pwned3).md')
      await fs.writeFile(file, '1 Sol Ring\n')
      // A name git would read as an option without the `--`.
      const dashed = path.join(repo, '-n.md')
      await fs.writeFile(dashed, '1 Island\n')

      commitFiles([file, dashed], message, repo)

      expect(git('log', '-1', '--format=%B').trim()).toBe(message)
      expect(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([
        '$(touch pwned3).md',
        '-n.md',
      ])
      expect(git('diff', '--cached', '--name-only').trim()).toBe('unrelated.md')
      for (const marker of ['pwned', 'pwned2', 'pwned3']) {
        expect(existsSync(path.join(repo, marker))).toBe(false)
      }
    } finally {
      await removeWorkspace(repo)
    }
  })
})
