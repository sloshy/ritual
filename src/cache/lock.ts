import path from 'node:path'
import os from 'node:os'
import type { FileSystemClient } from '../util/interfaces'
import { getCacheDir } from './file-cache'
import { getCacheLockTimeoutSeconds } from '../config/ritual-config'
import { hasErrorCode } from '../util/errors'
import { getLogger } from '../util/logger'
import { formatDuration } from '../util/duration'
import { t } from '../i18n/t'
import { syncDuration, syncMessage, SyncMessageError, syncRef } from '../sync/message'

export const CACHE_LOCK_FILENAME = '.ritual-cache-lock'

/**
 * The JSON payload written into the cache lock file by its holder — a machine
 * contract another Ritual process reads back, so its bytes never depend on the
 * UI language: numbers, the host name, and `operation` as the caller passed it.
 */
export interface CacheLockInfo {
  pid: number
  hostname: string
  createdAt: number
  /** What the holder is doing, as its caller worded it, e.g. "bulk card preload". */
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

/**
 * Thrown when the lock is still held by a live process after the wait timeout.
 *
 * A {@link SyncMessageError}: a refresh that times out may be running for the
 * admin API or MCP (`POST /api/cache/refresh`, a collection-sync push's cache
 * check), which answer in English plus the key, and the CLI prints it in its
 * own language — so the message travels unrendered, its timeout a duration
 * param rendered in whichever locale reads it.
 */
export class CacheLockTimeoutError extends SyncMessageError {
  constructor(
    readonly holder: CacheLockInfo | null,
    timeoutMs: number,
  ) {
    super(
      syncMessage('domain.cache.lockTimedOut', {
        timeout: syncDuration(timeoutMs),
        holder: holder
          ? syncRef('domain.cache.lockHolder', {
              operation: holder.operation,
              pid: holder.pid,
              hostname: holder.hostname,
            })
          : syncRef('domain.cache.lockHolderUnknown'),
      }),
    )
    this.name = 'CacheLockTimeoutError'
  }
}

const DEFAULT_POLL_INTERVAL_MS = 1000
// Fallback staleness bound for locks whose holder liveness cannot be checked
// (other host, or a recycled pid). Far longer than any real cache refresh.
const DEFAULT_STALE_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Parse the contents of a cache lock file. Returns an error string, worded in
 * the UI language, when the payload is malformed (a malformed lock is treated
 * as stale by the acquirer, which logs the reason).
 */
export function parseCacheLockInfo(raw: string): CacheLockInfo | string {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return t('cli.cacheLock.invalidJson')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return t('cli.cacheLock.notObject')
  }
  const info = json as Record<string, unknown>
  if (typeof info['pid'] !== 'number') return t('cli.cacheLock.missingField', { field: 'pid' })
  if (typeof info['hostname'] !== 'string') {
    return t('cli.cacheLock.missingField', { field: 'hostname' })
  }
  if (typeof info['createdAt'] !== 'number') {
    return t('cli.cacheLock.missingField', { field: 'createdAt' })
  }
  if (typeof info['operation'] !== 'string') {
    return t('cli.cacheLock.missingField', { field: 'operation' })
  }
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
      if (hasErrorCode(e, 'ENOENT')) continue
      throw e
    }

    if (typeof parsed === 'string' || isLockStale(parsed, isPidAlive, staleMaxAgeMs)) {
      const reason =
        typeof parsed === 'string' ? parsed : t('cli.cacheLock.holderGone', { pid: parsed.pid })
      getLogger().warn(t('cli.cacheLock.breakingStale', { reason }))
      await fs.unlink(lockPath)
      continue
    }

    if (Date.now() >= deadline) {
      throw new CacheLockTimeoutError(parsed, timeoutMs)
    }
    if (!announcedWait) {
      announcedWait = true
      getLogger().info(
        t('cli.cacheLock.waiting', {
          operation: parsed.operation,
          pid: parsed.pid,
          timeout: formatDuration(timeoutMs),
        }),
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
