import * as fs from 'node:fs/promises'
import { type CacheSection } from '../cache'
import { type FileSystemClient } from '../interfaces'
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
  return {
    readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
    writeFile: async (filePath, data) => {
      await fs.writeFile(filePath, data)
    },
    access: (filePath) => fs.access(filePath),
    copyFile: (source, destination) => fs.copyFile(source, destination),
    mkdir: (dirPath, options) => fs.mkdir(dirPath, options).then(() => {}),
  }
}

export function logCacheUpdate(message: string): void {
  console.log(`${CACHE_SERVER_LOG_PREFIX} cache update: ${message}`)
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

export function logVerboseRequest(request: Request, status: number, durationMs: number): void {
  const url = new URL(request.url)
  console.log(
    `${CACHE_SERVER_LOG_PREFIX} ${request.method} ${url.pathname}${url.search} -> ${status} (${durationMs}ms)`,
  )
}
