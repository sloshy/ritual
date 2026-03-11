import { describe, test, expect } from 'bun:test'
import { isGitRepo, shouldAutoCommit } from '../../src/admin/git'
import { getDefaultConfig } from '../../src/admin/config'
import type { AdminConfig } from '../../src/admin/config'
import path from 'node:path'
import os from 'node:os'

describe('admin git', () => {
  test('isGitRepo returns true for a directory inside a git repo', () => {
    const projectRoot = path.join(import.meta.dir, '../..')
    expect(isGitRepo(projectRoot)).toBe(true)
  })

  test('isGitRepo returns false for a non-git directory', () => {
    expect(isGitRepo(os.tmpdir())).toBe(false)
  })

  test('shouldAutoCommit returns true when git is enabled and dir is a repo', () => {
    const config: AdminConfig = {
      ...getDefaultConfig(),
      decksDir: './decks',
      collectionsDir: './collections',
      gitEnabled: true,
      gitAutoCommit: true,
    }
    const projectRoot = path.join(import.meta.dir, '../..')
    expect(shouldAutoCommit(config, projectRoot)).toBe(true)
  })

  test('shouldAutoCommit returns false when git is disabled', () => {
    const config: AdminConfig = {
      ...getDefaultConfig(),
      decksDir: './decks',
      collectionsDir: './collections',
      gitEnabled: false,
      gitAutoCommit: true,
    }
    const projectRoot = path.join(import.meta.dir, '../..')
    expect(shouldAutoCommit(config, projectRoot)).toBe(false)
  })

  test('shouldAutoCommit returns false when autoCommit is disabled', () => {
    const config: AdminConfig = {
      ...getDefaultConfig(),
      decksDir: './decks',
      collectionsDir: './collections',
      gitEnabled: true,
      gitAutoCommit: false,
    }
    const projectRoot = path.join(import.meta.dir, '../..')
    expect(shouldAutoCommit(config, projectRoot)).toBe(false)
  })
})
