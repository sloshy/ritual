import * as fs from 'node:fs/promises'
import type { PriceCurrency } from './price-currency'

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

export interface FileSystemClient {
  readFile(path: string, encoding: BufferEncoding): Promise<string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  access(path: string): Promise<void>
  copyFile(source: string, destination: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

/** Create a FileSystemClient backed by node:fs/promises. */
export function createDefaultFileSystemClient(): FileSystemClient {
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

export interface PricingBackend {
  fetchLatestPrices(names: string[], currency: PriceCurrency): Promise<Map<string, number>>
  fetchMinMaxPrice(name: string, currency: PriceCurrency): Promise<{ min: number; max: number }>
}
