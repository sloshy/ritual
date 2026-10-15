import type { BulkSetOptions, CacheManager, CacheStreamEntryMeta } from '../util/interfaces'
import type { CacheSection, DataType } from './file-cache'
import {
  isRenderable,
  nestSync,
  prefixedMessage,
  readSyncMessage,
  syncMessage,
  SyncMessageError,
  type PrefixedMessage,
  type SyncMessage,
  type SyncText,
} from '../sync/message'

interface CacheServerGetResponse<T> {
  value: T | null
}

interface CacheServerTimestampResponse {
  timestamp: number | null
}

interface CacheServerKeysResponse {
  keys: string[]
}

interface CacheServerValuesResponse<T> {
  values: T[]
}

interface CacheServerIsEmptyResponse {
  isEmpty: boolean
}

interface CacheServerSetRequest<T> {
  value: T
}

/** The `PUT /bulk` body: the entries, plus the options the server's own `bulkSet` takes. */
interface CacheServerBulkSetRequest<T> extends BulkSetOptions {
  entries: Record<string, T>
}

interface CacheServerStreamRequest {
  keys: string[]
}

interface CacheServerStreamEntry<T> {
  key: string
  value: T
  updated: boolean
}

const MAX_SSE_BUFFER_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * The `error` event of `POST /cache/prices/stream`: why a price could not be
 * resolved, as English plus its key and params (a Scryfall request failure, a
 * price batch naming unknown cards), and the cache key it was resolving when
 * the failure belongs to one. Another Ritual process reads it, so the text is
 * English whatever the server's UI language.
 */
export type CacheServerStreamError = SyncMessage & { key?: string }

/**
 * The body of a cache-server `500`: a fixed `error` line, and the failure
 * itself under `details` — English, with `detailsKey` / `detailsParams` beside
 * it when the failure has a catalog entry.
 */
export type CacheServerFailureBody = { error: string } & PrefixedMessage<'details'>

/**
 * A message another Ritual process sent, as a param: nested when this process
 * can render it whole, so it reads in the reader's language — and its English
 * as it came otherwise. A newer server may send a key, a param or a param kind
 * this process does not know, and nesting that would render the server's
 * sentence as a raw key or `{token}`, its English lost.
 */
function sentMessageParam(message: SyncMessage): SyncText {
  const nested = nestSync(message)
  return typeof nested === 'string' || isRenderable(nested) ? nested : message.message
}

/**
 * The server's own reply to a failed request, as a message param: the
 * failure a Ritual cache server sent as English plus its key (per
 * {@link sentMessageParam}), or the reply's text as it came.
 */
function replyParam(body: string): SyncText {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      const details = prefixedMessage('details', parsed)
      if (details !== undefined) return sentMessageParam(details)
    }
  } catch {
    // Not JSON: quoted as it came.
  }
  return body
}

/**
 * A stream `error` event as the error to throw: the server's failure (per
 * {@link sentMessageParam}), naming the cache key it was resolving when the
 * event carries one. Data that is not an error event is quoted as it came.
 */
function streamFailure(data: string): SyncMessageError {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    parsed = null
  }
  const message = readSyncMessage(parsed)
  if (message === null) {
    return new SyncMessageError(syncMessage('domain.cache.serverStreamError', { error: data }))
  }
  const error = sentMessageParam(message)
  const key = (parsed as Partial<CacheServerStreamError>).key
  return new SyncMessageError(
    typeof key === 'string'
      ? syncMessage('domain.cache.serverStreamEntryError', { key, error })
      : syncMessage('domain.cache.serverStreamError', { error }),
  )
}

/**
 * A failed cache-server request, as the error to throw. Keyed (a
 * {@link SyncMessageError}) because the cache is read by the admin API and MCP
 * as well as the CLI: a route answers it in English plus the key, the CLI
 * prints it in its own language. `body` is the server's own reply: the failure
 * a Ritual cache server reports, nested with its key, or any other reply's text
 * quoted as it came.
 */
async function requestFailure(
  response: Response,
  method: string,
  url: string,
): Promise<SyncMessageError> {
  const body = await response.text().catch(() => '')
  const status = response.status
  return new SyncMessageError(
    body
      ? syncMessage('domain.cache.serverRequestFailedWithBody', {
          status,
          method,
          url,
          body: replyParam(body),
        })
      : syncMessage('domain.cache.serverRequestFailed', { status, method, url }),
  )
}

export class HttpCacheManager<K extends CacheSection> implements CacheManager<DataType<K>> {
  constructor(
    private baseUrl: string,
    private section: K,
  ) {}

  private buildPath(pathSuffix: string): string {
    return `${this.baseUrl}/cache/${this.section}${pathSuffix}`
  }

  private async requestJson<T>(pathSuffix: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.buildPath(pathSuffix), init)
    if (!response.ok) {
      throw await requestFailure(response, init?.method ?? 'GET', this.buildPath(pathSuffix))
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }

  async get(key: string): Promise<DataType<K> | null> {
    const response = await this.requestJson<CacheServerGetResponse<DataType<K>>>(
      `/${encodeURIComponent(key)}`,
    )
    return response.value
  }

  async getTimestamp(key: string): Promise<number | null> {
    const response = await this.requestJson<CacheServerTimestampResponse>(
      `/${encodeURIComponent(key)}/timestamp`,
    )
    return response.timestamp
  }

  async getLastRefreshedAt(): Promise<number | null> {
    const response = await this.requestJson<CacheServerTimestampResponse>('/metadata')
    return response.timestamp
  }

  async streamGetMany(
    keys: string[],
    onEntry: (key: string, value: DataType<K>, meta: CacheStreamEntryMeta) => void,
  ): Promise<Record<string, DataType<K>>> {
    if (this.section !== 'prices') {
      throw new SyncMessageError(syncMessage('domain.cache.serverStreamPricesOnly'))
    }

    if (keys.length === 0) return {}

    const response = await fetch(this.buildPath('/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys } satisfies CacheServerStreamRequest),
    })

    if (!response.ok) {
      throw await requestFailure(response, 'POST', this.buildPath('/stream'))
    }

    if (!response.body) {
      throw new SyncMessageError(syncMessage('domain.cache.serverStreamNoBody'))
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    const results: Record<string, DataType<K>> = {}
    let buffer = ''

    const handleEvent = (raw: string) => {
      let eventType = 'message'
      const dataLines: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.slice('event:'.length).trim()
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart())
        }
      }

      if (dataLines.length === 0) return
      const data = dataLines.join('\n')

      if (eventType === 'done') return
      if (eventType === 'error') {
        throw streamFailure(data)
      }
      if (eventType !== 'price') return

      try {
        const payload = JSON.parse(data) as CacheServerStreamEntry<DataType<K> | null>
        if (payload.value === null) return
        results[payload.key] = payload.value
        onEntry(payload.key, payload.value, { updated: payload.updated })
      } catch {
        // Skip malformed SSE events
        return
      }
    }

    const processBuffer = (flush: boolean) => {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary === -1) break
        const eventChunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (eventChunk.trim().length > 0) {
          handleEvent(eventChunk)
        }
      }
      if (flush && buffer.trim().length > 0) {
        handleEvent(buffer)
        buffer = ''
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_SSE_BUFFER_SIZE) {
        throw new SyncMessageError(syncMessage('domain.cache.serverStreamTooLarge'))
      }
      processBuffer(false)
    }
    buffer += decoder.decode()
    processBuffer(true)

    return results
  }

  async set(key: string, value: DataType<K>): Promise<void> {
    await this.requestJson<void>(`/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value } satisfies CacheServerSetRequest<DataType<K>>),
    })
  }

  async bulkSet(entries: Record<string, DataType<K>>, options?: BulkSetOptions): Promise<void> {
    await this.requestJson<void>('/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries,
        replace: options?.replace,
      } satisfies CacheServerBulkSetRequest<DataType<K>>),
    })
  }

  async isEmpty(): Promise<boolean> {
    const response = await this.requestJson<CacheServerIsEmptyResponse>('/is-empty')
    return response.isEmpty
  }

  async delete(key: string): Promise<void> {
    await this.requestJson<void>(`/${encodeURIComponent(key)}`, { method: 'DELETE' })
  }

  async clear(): Promise<void> {
    await this.requestJson<void>('', { method: 'DELETE' })
  }

  async keys(): Promise<string[]> {
    const response = await this.requestJson<CacheServerKeysResponse>('/keys')
    return response.keys
  }

  async values(): Promise<DataType<K>[]> {
    const response = await this.requestJson<CacheServerValuesResponse<DataType<K>>>('/values')
    return response.values
  }
}
