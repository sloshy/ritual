import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import os from 'node:os'
import {
  CACHE_LOCK_FILENAME,
  CacheLockTimeoutError,
  type CacheLockInfo,
  acquireCacheLock,
  parseCacheLockInfo,
  withCacheLock,
} from '../../src/cache/lock'
import { MemoryFileSystemClient, MemoryLogger, resetLogger, setLogger } from '../test-utils'

const LOCK_DIR = '/cache'
const LOCK_PATH = `${LOCK_DIR}/${CACHE_LOCK_FILENAME}`

/** Fast-polling options so contention tests finish in milliseconds. */
function fastOptions(overrides: Parameters<typeof acquireCacheLock>[2] = {}) {
  return {
    lockDir: LOCK_DIR,
    timeoutMs: 200,
    pollIntervalMs: 5,
    ...overrides,
  }
}

function writeHolder(fs: MemoryFileSystemClient, overrides: Partial<CacheLockInfo> = {}): void {
  const info: CacheLockInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: Date.now(),
    operation: 'test holder',
    ...overrides,
  }
  fs.files.set(LOCK_PATH, JSON.stringify(info))
}

describe('cache lock', () => {
  let fs: MemoryFileSystemClient

  beforeEach(() => {
    setLogger(new MemoryLogger())
    fs = new MemoryFileSystemClient()
  })

  afterEach(() => {
    resetLogger()
  })

  test('acquire writes holder info and release removes the lock file', async () => {
    const lock = await acquireCacheLock(fs, 'bulk card cache download', fastOptions())

    const written = parseCacheLockInfo(fs.files.get(LOCK_PATH)!)
    expect(written).toMatchObject({
      pid: process.pid,
      hostname: os.hostname(),
      operation: 'bulk card cache download',
    })

    await lock.release()
    expect(fs.files.has(LOCK_PATH)).toBeFalse()
  })

  test('a second acquire waits until the holder releases', async () => {
    const first = await acquireCacheLock(fs, 'first', fastOptions())

    let acquired = false
    const second = acquireCacheLock(fs, 'second', fastOptions({ isPidAlive: () => true })).then(
      (lock) => {
        acquired = true
        return lock
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(acquired).toBeFalse()

    await first.release()
    const lock = await second
    expect(acquired).toBeTrue()
    await lock.release()
  })

  test('times out with CacheLockTimeoutError while a live holder keeps the lock', async () => {
    writeHolder(fs, { pid: 12345, operation: 'long refresh' })

    const error = await acquireCacheLock(
      fs,
      'blocked',
      fastOptions({ timeoutMs: 40, isPidAlive: () => true }),
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CacheLockTimeoutError)
    expect((error as CacheLockTimeoutError).holder?.operation).toBe('long refresh')
    // The original holder's lock file is left in place.
    expect(fs.files.has(LOCK_PATH)).toBeTrue()
  })

  test('breaks a lock whose same-host holder process is dead', async () => {
    writeHolder(fs, { pid: 99999 })

    const lock = await acquireCacheLock(fs, 'next', fastOptions({ isPidAlive: () => false }))
    expect(parseCacheLockInfo(fs.files.get(LOCK_PATH)!)).toMatchObject({ operation: 'next' })
    await lock.release()
  })

  test('breaks a malformed lock file', async () => {
    fs.files.set(LOCK_PATH, 'not json at all')

    const lock = await acquireCacheLock(fs, 'next', fastOptions({ isPidAlive: () => true }))
    expect(parseCacheLockInfo(fs.files.get(LOCK_PATH)!)).toMatchObject({ operation: 'next' })
    await lock.release()
  })

  test('breaks an over-age lock even when holder liveness is unknowable', async () => {
    // A different hostname means the pid check cannot apply; age decides.
    writeHolder(fs, { hostname: 'some-other-host', createdAt: Date.now() - 60_000 })

    const lock = await acquireCacheLock(
      fs,
      'next',
      fastOptions({ isPidAlive: () => true, staleMaxAgeMs: 1000 }),
    )
    expect(parseCacheLockInfo(fs.files.get(LOCK_PATH)!)).toMatchObject({ operation: 'next' })
    await lock.release()
  })

  test('honors a fresh lock from another host until timeout', async () => {
    writeHolder(fs, { hostname: 'some-other-host' })

    const error = await acquireCacheLock(
      fs,
      'blocked',
      fastOptions({ timeoutMs: 40, isPidAlive: () => false }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CacheLockTimeoutError)
  })

  test('withCacheLock releases the lock when the wrapped function throws', async () => {
    const error = await withCacheLock(
      fs,
      'failing op',
      async () => {
        expect(fs.files.has(LOCK_PATH)).toBeTrue()
        throw new Error('boom')
      },
      fastOptions(),
    ).catch((e: unknown) => e)

    expect((error as Error).message).toBe('boom')
    expect(fs.files.has(LOCK_PATH)).toBeFalse()
  })

  test('withCacheLock returns the wrapped result and releases', async () => {
    const result = await withCacheLock(fs, 'op', async () => 42, fastOptions())
    expect(result).toBe(42)
    expect(fs.files.has(LOCK_PATH)).toBeFalse()
  })
})

describe('parseCacheLockInfo', () => {
  test('parses a valid payload', () => {
    const info = { pid: 1, hostname: 'h', createdAt: 2, operation: 'op' }
    expect(parseCacheLockInfo(JSON.stringify(info))).toEqual(info)
  })

  test.each([
    ['not json', 'not valid JSON'],
    ['[]', 'expected an object'],
    ['{"hostname":"h","createdAt":2,"operation":"op"}', 'missing numeric pid'],
    ['{"pid":1,"createdAt":2,"operation":"op"}', 'missing string hostname'],
    ['{"pid":1,"hostname":"h","operation":"op"}', 'missing numeric createdAt'],
    ['{"pid":1,"hostname":"h","createdAt":2}', 'missing string operation'],
  ])('returns an error string for %s', (raw, expected) => {
    const result = parseCacheLockInfo(raw)
    expect(typeof result).toBe('string')
    expect(result as string).toContain(expected)
  })
})
