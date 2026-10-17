import type { BulkSetOptions, CacheManager, CacheStreamEntryMeta } from '../util/interfaces'
import type { CacheSection, DataType } from './file-cache'
import { syncMessage, SyncMessageError, type SyncMessage } from '../sync/message'
import { replyParam, streamFailureMessage } from './server-reply'
import { readReplyText } from '../util/reply-text'

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
 * A failed cache-server request, as the error to throw. Keyed (a
 * {@link SyncMessageError}) because the cache is read by the admin API and MCP
 * as well as the CLI: a route answers it in English plus the key, the CLI
 * prints it in its own language. Its `body` is the server's own reply (see
 * `replyParam`): a Ritual cache server's refusal nested with its key, or any
 * other reply's text quoted.
 */
async function requestFailure(
  response: Response,
  method: string,
  url: string,
): Promise<SyncMessageError> {
  const body = replyParam(await readReplyText(response))
  const status = response.status
  return new SyncMessageError(
    body === ''
      ? syncMessage('domain.cache.serverRequestFailed', { status, method, url })
      : syncMessage('domain.cache.serverRequestFailedWithBody', { status, method, url, body }),
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
        throw new SyncMessageError(streamFailureMessage(data))
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
