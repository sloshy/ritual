import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { getBaseDir, setBaseDir } from '../../../src/config/base-dir'
import {
  defaultDistDir,
  resolveOutDir,
  ritualArgv,
  type RitualArgvEnv,
} from '../../../src/site/dist-dir'

/**
 * `--out-dir` resolution and the subprocess command line.
 *
 * `resolveOutDir` is a safety boundary rather than a formatting check: the build
 * replaces its output directory wholesale, so a value that resolves to the
 * Ritual directory (or an ancestor of it) would delete the user's decks,
 * collections, and `.git`. Every refusal below is one of those.
 */

const BASE = '/home/tester/ritual'
let originalBase: string

beforeEach(() => {
  originalBase = getBaseDir()
  setBaseDir(BASE)
})

afterEach(() => {
  setBaseDir(originalBase)
})

describe('resolveOutDir', () => {
  test('defaults to the base dir’s dist/, matching defaultDistDir', () => {
    expect(resolveOutDir(undefined)).toEqual({ ok: true, dir: path.join(BASE, 'dist') })
    expect(defaultDistDir()).toBe(path.join(BASE, 'dist'))
  })

  test('resolves a relative path against the Ritual directory', () => {
    expect(resolveOutDir('public')).toEqual({ ok: true, dir: path.join(BASE, 'public') })
    expect(resolveOutDir('build/site')).toEqual({ ok: true, dir: path.join(BASE, 'build/site') })
  })

  test('takes an absolute path outside the base dir as given', () => {
    expect(resolveOutDir('/srv/www')).toEqual({ ok: true, dir: '/srv/www' })
  })

  test.each([
    ['blank', ''],
    ['whitespace only', '   '],
  ])('refuses a %s value', (_label, raw) => {
    const result = resolveOutDir(raw)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('requires a directory path')
  })

  test.each([
    ['the base dir spelled as "."', '.'],
    ['the base dir spelled absolutely', BASE],
    ['the base dir reached by traversal', 'sub/..'],
  ])('refuses %s', (_label, raw) => {
    const result = resolveOutDir(raw)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('may not be the Ritual directory itself')
  })

  test.each([
    ['the parent directory', '..'],
    ['a higher ancestor', '../..'],
    ['the filesystem root', '/'],
  ])('refuses %s, which contains the Ritual directory', (_label, raw) => {
    const result = resolveOutDir(raw)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('may not contain the Ritual directory')
  })

  test('a sibling that merely shares a name prefix is fine', () => {
    // `/home/tester/ritual-dist` starts with the base dir's string but is not an
    // ancestor of it — a prefix test rather than a path test would refuse it.
    expect(resolveOutDir('../ritual-dist')).toEqual({ ok: true, dir: '/home/tester/ritual-dist' })
  })
})

describe('ritualArgv', () => {
  test('runs the process’s own entry module under bun in source mode', () => {
    // `Bun.main`, not a path built from the base dir: the Ritual *data* directory
    // and the checkout are different places whenever RITUAL_DIR is set, and only
    // one of them has an index.ts.
    const env: RitualArgvEnv = {
      fromSource: true,
      main: '/checkout/ritual/index.ts',
      execPath: '/usr/local/bin/bun',
    }
    expect(ritualArgv(['build-site', '--out-dir', '/tmp/x'], env)).toEqual([
      '/usr/local/bin/bun',
      'run',
      '/checkout/ritual/index.ts',
      'build-site',
      '--out-dir',
      '/tmp/x',
    ])
  })

  test('invokes the binary directly when compiled', () => {
    // A compiled binary has no index.ts beside it, and its own argv[0] is the
    // command — `bun run <embedded path>` would not resolve.
    const env: RitualArgvEnv = {
      fromSource: false,
      main: '/$bunfs/root/ritual',
      execPath: '/usr/local/bin/ritual',
    }
    expect(ritualArgv(['build-site'], env)).toEqual(['/usr/local/bin/ritual', 'build-site'])
  })
})
