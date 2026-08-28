import { describe, test, expect } from 'bun:test'
import {
  isGitRepo,
  shouldAutoCommit,
  shouldAutoPush,
  suppressAutoCommit,
} from '../../src/admin/git'
import { getDefaultRitualConfig } from '../../src/config/ritual-config'
import type { RitualConfig } from '../../src/config/ritual-config'
import path from 'node:path'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'

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

    const inside = await suppressAutoCommit(
      async (): Promise<GateSnapshot> => ({
        commit: shouldAutoCommit(config, projectRoot),
        push: shouldAutoPush(config, projectRoot),
      }),
    )
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
})
