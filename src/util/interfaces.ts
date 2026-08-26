import * as fs from 'node:fs/promises'
import { hasErrorCode } from './errors'
import type { PriceCurrency } from '../pricing/price-currency'

/** A wrapper for making fetch requests and being able to mock responses. */
export interface HttpClient {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>
}

export interface CacheStreamEntryMeta {
  updated: boolean
}

export interface CacheManager<T> {
  get(key: string): Promise<T | null>
  getTimestamp?(key: string): Promise<number | null>
  getLastRefreshedAt?(): Promise<number | null>
  /** Drop any in-process memo so the next read reloads from the backing store. */
  invalidate?(): void
  streamGetMany(
    keys: string[],
    onEntry: (key: string, value: T, meta: CacheStreamEntryMeta) => void,
  ): Promise<Record<string, T>>
  set(key: string, value: T): Promise<void>
  bulkSet?(entries: Record<string, T>): Promise<void>
  isEmpty?(): Promise<boolean>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
  values(): Promise<T[]>
  resolveCardName?(lowercaseName: string): Promise<string | null>
  addToBlocklist?(name: string): Promise<void>
  isBlocked?(name: string): Promise<boolean>
  purgeExpiredBlocklist?(): Promise<void>
}

/** Outcome of an exclusive-create write: whether this caller created the file. */
export type ExclusiveWriteResult = 'created' | 'exists'

export type MkdirOptions = { recursive?: boolean }

export interface FileSystemClient {
  readFile(path: string, encoding: BufferEncoding): Promise<string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  /**
   * Atomically create `path` with `data`, failing softly when it already
   * exists. Returns 'created' when this caller won the creation race.
   */
  writeFileExclusive(path: string, data: string | Uint8Array): Promise<ExclusiveWriteResult>
  /** Atomically replace `destination` with `source` (POSIX rename semantics). */
  rename(source: string, destination: string): Promise<void>
  /** Delete a file; resolves even when it does not exist. */
  unlink(path: string): Promise<void>
  access(path: string): Promise<void>
  copyFile(source: string, destination: string): Promise<void>
  mkdir(path: string, options?: MkdirOptions): Promise<void>
}

/** Create a FileSystemClient backed by node:fs/promises. */
export function createDefaultFileSystemClient(): FileSystemClient {
  return {
    readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
    writeFile: async (filePath, data) => {
      await fs.writeFile(filePath, data)
    },
    writeFileExclusive: async (filePath, data) => {
      try {
        await fs.writeFile(filePath, data, { flag: 'wx' })
        return 'created'
      } catch (e) {
        if (hasErrorCode(e, 'EEXIST')) return 'exists'
        throw e
      }
    },
    rename: (source, destination) => fs.rename(source, destination),
    unlink: async (filePath) => {
      try {
        await fs.unlink(filePath)
      } catch (e) {
        if (!hasErrorCode(e, 'ENOENT')) throw e
      }
    },
    access: (filePath) => fs.access(filePath),
    copyFile: (source, destination) => fs.copyFile(source, destination),
    mkdir: (dirPath, options) => fs.mkdir(dirPath, options).then(() => {}),
  }
}

export interface PricingBackend {
  fetchLatestPrices(names: string[], currency: PriceCurrency): Promise<Map<string, number>>
  fetchMinMaxPrice(name: string, currency: PriceCurrency): Promise<{ min: number; max: number }>
}
