/** A wrapper for making fetch requests and being able to mock responses. */
export interface HttpClient {
  fetch(url: string | URL, init?: RequestInit): Promise<Response>
}

export interface CacheManager<T> {
  get(key: string): Promise<T | null>
  set(key: string, value: T): Promise<void>
  bulkSet?(entries: Record<string, T>): Promise<void>
  isEmpty?(): Promise<boolean>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
  values(): Promise<T[]>
}

export interface FileSystemClient {
  readFile(path: string, encoding: BufferEncoding): Promise<string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  access(path: string): Promise<void>
  copyFile(source: string, destination: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
}

export interface PricingBackend {
  fetchLatestPrices(names: string[]): Promise<Map<string, number>>
  fetchMinMaxPrice(name: string): Promise<{ min: number; max: number }>
}
