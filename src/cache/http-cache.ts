import type { CacheManager, CacheStreamEntryMeta } from '../util/interfaces'
import type { CacheSection, DataType } from './file-cache'

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

interface CacheServerBulkSetRequest<T> {
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
      const body = await response.text().catch(() => '')
      throw new Error(
        `Cache server request failed (${response.status}) ${init?.method ?? 'GET'} ${this.buildPath(pathSuffix)}${body ? `: ${body}` : ''}`,
      )
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
      throw new Error('streamGetMany is only supported for prices cache.')
    }

    if (keys.length === 0) return {}

    const response = await fetch(this.buildPath('/stream'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys } satisfies CacheServerStreamRequest),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Cache server request failed (${response.status}) POST ${this.buildPath('/stream')}${body ? `: ${body}` : ''}`,
      )
    }

    if (!response.body) {
      throw new Error('Cache server stream response body is missing.')
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
        throw new Error(`Cache server stream error: ${data}`)
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
        throw new Error('Cache server stream buffer exceeded maximum size')
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

  async bulkSet(entries: Record<string, DataType<K>>): Promise<void> {
    await this.requestJson<void>('/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries } satisfies CacheServerBulkSetRequest<DataType<K>>),
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
