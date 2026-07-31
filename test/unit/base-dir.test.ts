import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { isBaseDirError, parseBaseDir, resolveBaseDir, type BaseDirError } from '../../src/base-dir'

/** The error message of a {@link parseBaseDir} result, or a failing marker. */
function errorOf(result: string | BaseDirError): string {
  return isBaseDirError(result) ? result.error : `expected an error, got ${result}`
}

describe('resolveBaseDir', () => {
  test('prefers the flag over the environment variable', () => {
    expect(resolveBaseDir('/from/flag', '/from/env')).toBe('/from/flag')
  })

  test('falls back to RITUAL_BASE_DIR when the flag is absent', () => {
    expect(resolveBaseDir(undefined, '/from/env')).toBe('/from/env')
  })

  test('treats blank values as unset on both sources', () => {
    expect(resolveBaseDir('   ', '  ')).toBeUndefined()
    expect(resolveBaseDir(undefined, '')).toBeUndefined()
    expect(resolveBaseDir('  ', '/from/env')).toBe('/from/env')
  })

  test('returns undefined when neither source is set', () => {
    expect(resolveBaseDir(undefined, undefined)).toBeUndefined()
  })
})

describe('parseBaseDir', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'ritual-base-dir-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('resolves an unnormalized path to its absolute form', async () => {
    // Raw concatenation: path.join would normalize `sub/..` away before the call.
    const result = await parseBaseDir(`${dir}${path.sep}sub${path.sep}..`)
    expect(result).toBe(dir)
  })

  test('resolves a relative path against the working directory', async () => {
    const relative = path.relative(process.cwd(), dir)
    expect(await parseBaseDir(relative)).toBe(dir)
  })

  test('error messages name the resolved absolute path, not the raw input', async () => {
    const relative = path.relative(process.cwd(), path.join(dir, 'nope'))
    const result = await parseBaseDir(relative)
    expect(errorOf(result)).toBe(`base directory does not exist: ${path.join(dir, 'nope')}`)
  })

  test('rejects a path that does not exist, naming the resolved path', async () => {
    const missing = path.join(dir, 'nope')
    const result = await parseBaseDir(missing)
    expect(errorOf(result)).toBe(`base directory does not exist: ${missing}`)
  })

  test('rejects a regular file', async () => {
    const file = path.join(dir, 'ritual.config.json')
    await fs.writeFile(file, '{}')
    const result = await parseBaseDir(file)
    expect(errorOf(result)).toBe(`base directory is not a directory: ${file}`)
  })

  test('rejects a path whose prefix is a file', async () => {
    const file = path.join(dir, 'notes.txt')
    await fs.writeFile(file, 'hi')
    const nested = path.join(file, 'inner')
    const result = await parseBaseDir(nested)
    expect(errorOf(result)).toBe(`base directory is not a directory: ${nested}`)
  })

  test('does not create the directory it rejects', async () => {
    const missing = path.join(dir, 'typo')
    await parseBaseDir(missing)
    expect(await fs.readdir(dir)).toEqual([])
  })
})
