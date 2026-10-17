import type { CacheSection } from '../cache'
import { t } from '../i18n/t'
import { createDefaultFileSystemClient, type FileSystemClient } from '../util/interfaces'
import { CACHE_SERVER_LOG_PREFIX, DAY_REFRESH_MS, PRICE_REFRESH_STAGGER_MS } from './constants'

const textEncoder = new TextEncoder()

type StaggeredTaskSuccess<T> = { failed: false; index: number; result: T }
type StaggeredTaskFailure = { failed: true; index: number; error: unknown }
type StaggeredTaskResult<T> = StaggeredTaskSuccess<T> | StaggeredTaskFailure

interface PendingStaggeredTask<T> {
  index: number
  promise: Promise<StaggeredTaskResult<T>>
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function getSection(section: string): CacheSection | null {
  if (section === 'prices' || section === 'cards') return section
  return null
}

export function createFileSystemClient(): FileSystemClient {
  return createDefaultFileSystemClient()
}

/** Log a cache change; `fields` is machine `key=value` tokens (`section=prices action=set`). */
export function logCacheUpdate(fields: string): void {
  console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.cacheUpdate', { fields })}`)
}

export function sseEvent(event: string, data: unknown): Uint8Array {
  return textEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function isOlderThan(
  timestamp: number | null,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean {
  if (timestamp === null) return true
  return now - timestamp > maxAgeMs
}

export function shouldForcePriceRefresh(
  cadenceMs: number,
  lastUpdatedAt: number | null,
  scheduledAt: number | null,
  now: number = Date.now(),
): boolean {
  if (cadenceMs <= DAY_REFRESH_MS) return false
  if (lastUpdatedAt === null || scheduledAt === null) return false

  const age = now - lastUpdatedAt
  if (age <= DAY_REFRESH_MS) return false

  return now < scheduledAt
}

export function getInitialPriceRefreshAt(
  cadenceMs: number,
  lastUpdatedAt: number,
  now: number,
  staleQueueIndex: number,
  staggerMs: number = PRICE_REFRESH_STAGGER_MS,
): number {
  if (now - lastUpdatedAt > cadenceMs) {
    return now + staleQueueIndex * staggerMs
  }
  return lastUpdatedAt + cadenceMs
}

export async function runStaggeredTasksInCompletionOrder<T>(
  tasks: Array<() => Promise<T>>,
  staggerMs: number,
  onSuccess: (result: T, index: number) => void | Promise<void>,
  onError: (error: unknown, index: number) => void | Promise<void>,
): Promise<void> {
  const pending: PendingStaggeredTask<T>[] = tasks.map((run, index) => ({
    index,
    promise: (async () => {
      if (index > 0) {
        await Bun.sleep(index * staggerMs)
      }
      return run()
    })()
      .then((result): StaggeredTaskSuccess<T> => ({ failed: false, index, result }))
      .catch((error): StaggeredTaskFailure => ({ failed: true, index, error })),
  }))

  while (pending.length > 0) {
    const settled = await Promise.race(pending.map((entry) => entry.promise))
    const pendingIndex = pending.findIndex((entry) => entry.index === settled.index)
    if (pendingIndex >= 0) {
      pending.splice(pendingIndex, 1)
    }

    if (settled.failed) {
      await onError(settled.error, settled.index)
    } else {
      await onSuccess(settled.result, settled.index)
    }
  }
}

/** The methods a cache entry's route (`/cache/<section>/<key>`) answers; a `405` names them. */
export const ENTRY_METHODS = ['GET', 'PUT', 'DELETE'] as const

/**
 * A request-path segment decoded, or `undefined` when its `%` escapes are
 * malformed (`decodeURIComponent` throws on them) — so a server answers that
 * with a keyed refusal instead of an unhandled throw. The cache server reads
 * its cache keys through it, the cache-feed host its file and torrent names.
 */
export function decodePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/**
 * One `--verbose` access-log record: every field machine data (method,
 * percent-encoded path and query, status, elapsed milliseconds) — so it is
 * `key=value` tokens, never a sentence, and is never translated. The cache
 * server and the cache-feed host both log requests in this form.
 *
 * Tokens are separated by single spaces, and no value holds a space (a path is
 * percent-encoded). A `path` value may itself contain `=` (a query string such
 * as `?a=b`), so a consumer splits each token on its **first** `=` only.
 */
export function accessLogFields(request: Request, status: number, durationMs: number): string {
  const url = new URL(request.url)
  return `method=${request.method} path=${url.pathname}${url.search} status=${status} durationMs=${durationMs}`
}

/** The cache server's `--verbose` access log: {@link accessLogFields} behind its prefix. */
export function logVerboseRequest(request: Request, status: number, durationMs: number): void {
  console.log(`${CACHE_SERVER_LOG_PREFIX} ${accessLogFields(request, status, durationMs)}`)
}
