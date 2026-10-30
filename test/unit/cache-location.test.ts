import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  cacheDirProblem,
  resolveCacheDir,
  type CacheDirProblem,
} from '../../src/config/cache-location'
import { defaultUserCacheDir, type UserDirsEnvironment } from '../../src/util/user-dirs'

const HOME = '/home/ada'
const WORKSPACE = '/work/decks-repo'

function linux(env: Record<string, string | undefined> = {}): UserDirsEnvironment {
  return { env, platform: 'linux', home: HOME }
}

describe('defaultUserCacheDir', () => {
  test('Linux uses $XDG_CACHE_HOME/ritual, else ~/.cache/ritual', () => {
    expect(defaultUserCacheDir(linux({ XDG_CACHE_HOME: '/var/cache/ada' }))).toBe(
      '/var/cache/ada/ritual',
    )
    expect(defaultUserCacheDir(linux())).toBe('/home/ada/.cache/ritual')
    // Blank reads as unset, and so does a relative value (the XDG spec calls it invalid).
    expect(defaultUserCacheDir(linux({ XDG_CACHE_HOME: '  ' }))).toBe('/home/ada/.cache/ritual')
    expect(defaultUserCacheDir(linux({ XDG_CACHE_HOME: 'rel/cache' }))).toBe(
      '/home/ada/.cache/ritual',
    )
  })

  test('macOS uses ~/Library/Caches/ritual and ignores XDG', () => {
    expect(
      defaultUserCacheDir({
        env: { XDG_CACHE_HOME: '/x' },
        platform: 'darwin',
        home: '/Users/ada',
      }),
    ).toBe('/Users/ada/Library/Caches/ritual')
  })

  test('Windows uses %LOCALAPPDATA%\\ritual\\cache, else the profile’s AppData\\Local', () => {
    expect(
      defaultUserCacheDir({
        env: { LOCALAPPDATA: 'D:\\Data\\Local' },
        platform: 'win32',
        home: 'C:\\Users\\ada',
      }),
    ).toBe('D:\\Data\\Local\\ritual\\cache')
    expect(defaultUserCacheDir({ env: {}, platform: 'win32', home: 'C:\\Users\\ada' })).toBe(
      'C:\\Users\\ada\\AppData\\Local\\ritual\\cache',
    )
  })
})

describe('resolveCacheDir', () => {
  test('RITUAL_CACHE_DIR outranks the cacheDir key, which outranks the default', () => {
    const configured = '/srv/config-cache'
    expect(
      resolveCacheDir({
        baseDir: WORKSPACE,
        configured,
        environment: linux({ RITUAL_CACHE_DIR: '/srv/env-cache' }),
      }),
    ).toEqual({ dir: '/srv/env-cache', source: 'env' })
    expect(resolveCacheDir({ baseDir: WORKSPACE, configured, environment: linux() })).toEqual({
      dir: configured,
      source: 'config',
    })
    expect(resolveCacheDir({ baseDir: WORKSPACE, environment: linux() })).toEqual({
      dir: '/home/ada/.cache/ritual',
      source: 'default',
    })
  })

  test('relative values from either source resolve against the workspace, not the cwd', () => {
    expect(
      resolveCacheDir({
        baseDir: WORKSPACE,
        environment: linux({ RITUAL_CACHE_DIR: 'cache' }),
      }),
    ).toEqual({ dir: path.resolve(WORKSPACE, 'cache'), source: 'env' })
    expect(
      resolveCacheDir({ baseDir: WORKSPACE, configured: '../shared', environment: linux() }),
    ).toEqual({ dir: path.resolve(WORKSPACE, '../shared'), source: 'config' })
  })

  test('a blank variable falls through to the cacheDir key, and values are trimmed', () => {
    expect(
      resolveCacheDir({
        baseDir: WORKSPACE,
        configured: ' /srv/config-cache ',
        environment: linux({ RITUAL_CACHE_DIR: '  ' }),
      }),
    ).toEqual({ dir: '/srv/config-cache', source: 'config' })
  })

  test('blank values on either source count as unset', () => {
    expect(
      resolveCacheDir({
        baseDir: WORKSPACE,
        configured: ' ',
        environment: linux({ RITUAL_CACHE_DIR: '' }),
      }),
    ).toEqual({ dir: '/home/ada/.cache/ritual', source: 'default' })
  })
})

describe('cacheDirProblem', () => {
  const context = {
    baseDir: WORKSPACE,
    listDirs: ['./decks', './collections', '/srv/wanted'],
    home: HOME,
  }

  test.each<[string, CacheDirProblem]>([
    ['~/ritual-cache', 'tilde'],
    ['/', 'root'],
    [HOME, 'home'],
    ['.', 'workspace'],
    ['..', 'workspace'],
    [WORKSPACE, 'workspace'],
    ['decks', 'list-dir'],
    ['./collections/cache', 'list-dir'],
    ['/srv/wanted', 'list-dir'],
  ])('refuses %p (%s)', (value, problem) => {
    expect(cacheDirProblem(value, context)).toBe(problem)
  })

  test.each([['cache'], ['../shared-cache'], ['/var/cache/ritual'], [`${HOME}/.cache/ritual`]])(
    'accepts %p',
    (value) => {
      expect(cacheDirProblem(value, context)).toBeNull()
    },
  )
})
