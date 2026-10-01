import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveUserStateDir, type UserDirsEnvironment } from '../../src/util/user-dirs'
import {
  emptyUserState,
  parseUserState,
  readUserState,
  userStatePath,
  writeUserStateSection,
} from '../../src/util/user-state'

describe('resolveUserStateDir', () => {
  const at = (
    platform: NodeJS.Platform,
    env: Record<string, string | undefined> = {},
  ): UserDirsEnvironment => ({
    platform,
    env,
    home: platform === 'win32' ? 'C:\\Users\\ada' : '/home/ada',
  })

  test.each<[string, UserDirsEnvironment, string]>([
    [
      'Linux with XDG_STATE_HOME',
      at('linux', { XDG_STATE_HOME: '/xdg/state' }),
      '/xdg/state/ritual',
    ],
    ['Linux without it', at('linux'), '/home/ada/.local/state/ritual'],
    [
      'Linux with a blank XDG_STATE_HOME',
      at('linux', { XDG_STATE_HOME: ' ' }),
      '/home/ada/.local/state/ritual',
    ],
    ['macOS', at('darwin'), '/home/ada/Library/Application Support/ritual'],
    [
      'macOS ignores XDG_STATE_HOME',
      at('darwin', { XDG_STATE_HOME: '/xdg/state' }),
      '/home/ada/Library/Application Support/ritual',
    ],
    [
      'a blank RITUAL_STATE_DIR falls through',
      at('linux', { RITUAL_STATE_DIR: ' ' }),
      '/home/ada/.local/state/ritual',
    ],
    ['Windows with LOCALAPPDATA', at('win32', { LOCALAPPDATA: 'D:\\Local' }), 'D:\\Local\\ritual'],
    ['Windows without it', at('win32'), 'C:\\Users\\ada\\AppData\\Local\\ritual'],
    ['any platform with RITUAL_STATE_DIR', at('darwin', { RITUAL_STATE_DIR: '/tmp/s' }), '/tmp/s'],
  ])('%s', (_label, environment, expected) => {
    expect(resolveUserStateDir(environment)).toBe(expected)
  })
})

describe('parseUserState', () => {
  test('content that is not an object is an error', () => {
    expect(typeof parseUserState([])).toBe('string')
    expect(typeof parseUserState('x')).toBe('string')
  })

  test('keeps well-formed prompt times and drops malformed ones', () => {
    expect(
      parseUserState({
        migratePrompts: { '/a': 5, '/z': 0, '/b': 'soon', '/c': -1, '/d': Infinity },
      }),
    ).toEqual({ migratePrompts: { '/a': 5, '/z': 0 } })
  })

  test('a malformed section reads as empty rather than failing the whole file', () => {
    expect(parseUserState({ migratePrompts: 'nope', future: 1 })).toEqual(emptyUserState())
  })
})

describe('the state file', () => {
  const originalOverride = process.env.RITUAL_STATE_DIR
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-state-'))
    process.env.RITUAL_STATE_DIR = path.join(dir, 'nested', 'state')
  })
  afterEach(async () => {
    if (originalOverride === undefined) delete process.env.RITUAL_STATE_DIR
    else process.env.RITUAL_STATE_DIR = originalOverride
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('a missing file reads as empty, and a write creates its directory', async () => {
    expect(await readUserState()).toEqual(emptyUserState())

    await writeUserStateSection('migratePrompts', { '/ws': 42 })

    expect(await readUserState()).toEqual({ migratePrompts: { '/ws': 42 } })
  })

  test('a corrupt file reads as empty and the next write replaces it', async () => {
    await fs.mkdir(path.dirname(userStatePath()), { recursive: true })
    await fs.writeFile(userStatePath(), '{ not json')

    expect(await readUserState()).toEqual(emptyUserState())
    await writeUserStateSection('migratePrompts', { '/ws': 1 })
    expect(await readUserState()).toEqual({ migratePrompts: { '/ws': 1 } })
  })

  test('a write keeps sections this build does not know', async () => {
    await fs.mkdir(path.dirname(userStatePath()), { recursive: true })
    await fs.writeFile(userStatePath(), JSON.stringify({ updateCheck: { at: 7 } }))

    await writeUserStateSection('migratePrompts', { '/ws': 1 })

    expect(JSON.parse(await fs.readFile(userStatePath(), 'utf-8'))).toEqual({
      updateCheck: { at: 7 },
      migratePrompts: { '/ws': 1 },
    })
  })

  test('a write that fails is swallowed', async () => {
    // The state "directory" is a regular file, so mkdir under it must fail.
    const blocker = path.join(dir, 'blocker')
    await fs.writeFile(blocker, '')
    process.env.RITUAL_STATE_DIR = path.join(blocker, 'state')

    // Resolves rather than rejects: a throw here would fail the test.
    await writeUserStateSection('migratePrompts', { '/ws': 1 })
    expect(await readUserState()).toEqual(emptyUserState())
  })
})
