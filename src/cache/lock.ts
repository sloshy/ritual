import path from 'node:path'
import os from 'node:os'
import type { FileSystemClient } from '../interfaces'
import { getCacheDir } from './file-cache'
import { getCacheLockTimeoutSeconds } from '../ritual-config'
import { hasErrorCode } from '../errors'
import { getLogger } from '../logger'
import { formatDuration } from '../utils'

export const CACHE_LOCK_FILENAME = '.ritual-cache-lock'

/** The JSON payload written into the cache lock file by its holder. */
export interface CacheLockInfo {
  pid: number
  hostname: string
  createdAt: number
  /** Human-readable description of the holder, e.g. "bulk card preload". */
  operation: string
}

/** A held cache lock; call {@link CacheLockHandle.release} when the write finishes. */
export interface CacheLockHandle {
  release(): Promise<void>
}

/** Injectable knobs for {@link acquireCacheLock}; production callers use the defaults. */
export type CacheLockOptions = {
  /** How long to wait for the lock before failing. Defaults to the configured `cacheLockTimeoutSeconds`. */
  timeoutMs?: number
  /** Directory holding the lock file. Defaults to the cache dir. */
  lockDir?: string
  pollIntervalMs?: number
  /** Age past which a lock is considered stale even when liveness is unknowable. */
  staleMaxAgeMs?: number
  isPidAlive?: (pid: number) => boolean
  sleep?: (ms: number) => Promise<void>
}

/** Thrown when the lock is still held by a live process after the wait timeout. */
export class CacheLockTimeoutError extends Error {
  constructor(
    readonly holder: CacheLockInfo | null,
    timeoutMs: number,
  ) {
    const holderText = holder
      ? `"${holder.operation}" (pid ${holder.pid} on ${holder.hostname})`
      : 'another process'
    super(
      `Timed out after ${formatDuration(timeoutMs)} waiting for the cache lock held by ${holderText}. ` +
        `If no other ritual process is running, delete the lock file manually.`,
    )
    this.name = 'CacheLockTimeoutError'
  }
}

const DEFAULT_POLL_INTERVAL_MS = 1000
// Fallback staleness bound for locks whose holder liveness cannot be checked
// (other host, or a recycled pid). Far longer than any real cache refresh.
const DEFAULT_STALE_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Parse the contents of a cache lock file. Returns an error string when the
 * payload is malformed (a malformed lock is treated as stale by the acquirer).
 */
export function parseCacheLockInfo(raw: string): CacheLockInfo | string {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return 'Invalid cache lock: not valid JSON'
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return 'Invalid cache lock: expected an object'
  }
  const info = json as Record<string, unknown>
  if (typeof info['pid'] !== 'number') return 'Invalid cache lock: missing numeric pid'
  if (typeof info['hostname'] !== 'string') return 'Invalid cache lock: missing string hostname'
  if (typeof info['createdAt'] !== 'number') return 'Invalid cache lock: missing numeric createdAt'
  if (typeof info['operation'] !== 'string') return 'Invalid cache lock: missing string operation'
  return json as CacheLockInfo
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM means the process exists but belongs to another user.
    return hasErrorCode(e, 'EPERM')
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Decide whether an existing lock can be broken: its holder process is dead
 * (same-host locks), or it exceeds the stale age bound.
 */
function isLockStale(
  info: CacheLockInfo,
  isPidAlive: (pid: number) => boolean,
  staleMaxAgeMs: number,
): boolean {
  if (info.hostname === os.hostname() && !isPidAlive(info.pid)) return true
  return Date.now() - info.createdAt > staleMaxAgeMs
}

/**
 * Acquire the exclusive cache-write lock (`.ritual-cache-lock` in the cache
 * dir). Cache-refreshing operations take this lock so concurrent processes
 * (CLI commands, the cache server, the admin server) never interleave writes.
 *
 * When the lock is already held, waits up to the configured timeout
 * (`cacheLockTimeoutSeconds`, default 5 minutes), breaking locks whose holder
 * is provably dead. Throws {@link CacheLockTimeoutError} when the wait expires.
 */
export async function acquireCacheLock(
  fs: FileSystemClient,
  operation: string,
  options: CacheLockOptions = {},
): Promise<CacheLockHandle> {
  const lockDir = options.lockDir ?? getCacheDir()
  const lockPath = path.join(lockDir, CACHE_LOCK_FILENAME)
  const timeoutMs = options.timeoutMs ?? getCacheLockTimeoutSeconds() * 1000
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive
  const sleep = options.sleep ?? defaultSleep

  await fs.mkdir(lockDir, { recursive: true })

  const info: CacheLockInfo = {
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: Date.now(),
    operation,
  }

  const deadline = Date.now() + timeoutMs
  let announcedWait = false

  while (true) {
    info.createdAt = Date.now()
    const result = await fs.writeFileExclusive(lockPath, JSON.stringify(info, null, 2))
    if (result === 'created') {
      return {
        release: () => fs.unlink(lockPath),
      }
    }

    let parsed: CacheLockInfo | string
    try {
      parsed = parseCacheLockInfo(await fs.readFile(lockPath, 'utf-8'))
    } catch (e) {
      // The holder released between our create attempt and read — retry now.
      // Only that narrow race is retried; any other read failure (permissions,
      // I/O) would otherwise spin here forever without honoring the deadline.
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) continue
      throw e
    }

    if (typeof parsed === 'string' || isLockStale(parsed, isPidAlive, staleMaxAgeMs)) {
      const description =
        typeof parsed === 'string'
          ? parsed
          : `holder pid ${parsed.pid} is no longer running or exceeded the stale age`
      getLogger().warn(`Breaking stale cache lock (${description}).`)
      await fs.unlink(lockPath)
      continue
    }

    if (Date.now() >= deadline) {
      throw new CacheLockTimeoutError(parsed, timeoutMs)
    }
    if (!announcedWait) {
      announcedWait = true
      getLogger().info(
        `Cache is locked by "${parsed.operation}" (pid ${parsed.pid}). ` +
          `Waiting up to ${formatDuration(timeoutMs)} for it to finish...`,
      )
    }
    await sleep(pollIntervalMs)
  }
}

/**
 * Run `fn` while holding the cache-write lock, always releasing it afterwards
 * (including when `fn` throws). Lock acquisitions must not nest within a
 * process — cache-refresh entry points take the lock, their internals do not.
 */
export async function withCacheLock<T>(
  fs: FileSystemClient,
  operation: string,
  fn: () => Promise<T>,
  options?: CacheLockOptions,
): Promise<T> {
  const lock = await acquireCacheLock(fs, operation, options)
  try {
    return await fn()
  } finally {
    await lock.release()
  }
}
