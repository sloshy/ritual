import { describe, test, expect } from 'bun:test'
import { isGitRepo, shouldAutoCommit } from '../../src/admin/git'
import { getDefaultConfig } from '../../src/admin/config'
import type { AdminConfig } from '../../src/admin/config'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

describe('admin git', () => {
  test('isGitRepo returns true for a directory inside a git repo', () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    expect(isGitRepo(projectRoot)).toBe(true)
  })

  test('isGitRepo returns false for a non-git directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ritual-test-'))
    try {
      expect(isGitRepo(tmpDir)).toBe(false)
    } finally {
      fs.rmdirSync(tmpDir)
    }
  })

  test('shouldAutoCommit requires both gitEnabled and gitAutoCommit in a repo', () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    const base = { ...getDefaultConfig(), decksDir: './decks', collectionsDir: './collections' }

    const cases: Array<{ gitEnabled: boolean; gitAutoCommit: boolean; expected: boolean }> = [
      { gitEnabled: true, gitAutoCommit: true, expected: true },
      { gitEnabled: false, gitAutoCommit: true, expected: false },
      { gitEnabled: true, gitAutoCommit: false, expected: false },
      { gitEnabled: false, gitAutoCommit: false, expected: false },
    ]

    for (const { gitEnabled, gitAutoCommit, expected } of cases) {
      const config: AdminConfig = { ...base, gitEnabled, gitAutoCommit }
      expect(shouldAutoCommit(config, projectRoot)).toBe(expected)
    }
  })
})
