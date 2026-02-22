import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { defaultCache } from '../../src/cache'
import { clearCacheServerAddressOverride, setCacheServerAddressOverride } from '../../src/cache-config'
import { PriceService } from '../../src/prices'
import { type PriceData, type ScryfallCard } from '../../src/types'

const repoRoot = path.resolve(import.meta.dir, '../..')
const binaryPath = path.join(repoRoot, 'ritual')
let binaryReady = false

interface RunningServer {
  cwd: string
  port: number
  process: Bun.Subprocess
  stdoutPromise: Promise<string>
  stderrPromise: Promise<string>
}

interface StopServerOutput {
  stdout: string
  stderr: string
}

interface StartServerOptions {
  verbose?: boolean
  cardsRefresh?: 'daily' | 'weekly' | 'monthly'
  pricesRefresh?: 'daily' | 'weekly' | 'monthly'
}

const testCard: ScryfallCard = {
  id: 'test-sol-ring',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '1.00', usd_foil: '2.00', usd_etched: null },
  finishes: ['nonfoil'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '233',
  rarity: 'uncommon',
}

const testPrice: PriceData = {
  latest: 1,
  min: 0.5,
  max: 2,
}

const testPrice2: PriceData = {
  latest: 2,
  min: 1,
  max: 3,
}

function pickPort(): number {
  return 41000 + Math.floor(Math.random() * 1000)
}

async function waitForHealth(port: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(200),
      })
      if (response.ok) return
    } catch {
      // wait and retry
    }
    await Bun.sleep(100)
  }
  throw new Error(`Cache server did not become healthy on port ${port}.`)
}

async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  if (!binaryReady) {
    const build = Bun.spawn(['bun', 'run', 'build'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await build.exited
    if (code !== 0) {
      const stderr = await new Response(build.stderr).text()
      throw new Error(`Failed to build ritual binary for cache-server test: ${stderr}`)
    }
    binaryReady = true
  }

  const cwd = path.join(tmpdir(), `ritual-cache-server-${crypto.randomUUID()}`)
  await fs.mkdir(path.join(cwd, 'cache'), { recursive: true })

  const now = Date.now()
  await Bun.write(
    path.join(cwd, 'cache', 'cache.json'),
    JSON.stringify(
      {
        prices: {
          'Sol Ring': {
            timestamp: now,
            data: testPrice,
          },
          'Arcane Signet': {
            timestamp: now,
            data: testPrice2,
          },
        },
        cards: {
          'Sol Ring': {
            timestamp: now,
            data: [testCard],
          },
        },
        metadata: {
          prices: { lastRefreshedAt: now },
          cards: { lastRefreshedAt: now },
        },
      },
      null,
      2,
    ),
  )

  const port = pickPort()
  const args = [binaryPath, 'cache-server', '--host', '127.0.0.1', '--port', String(port)]
  if (options.verbose) {
    args.push('--verbose')
  }
  if (options.cardsRefresh) {
    args.push('--cards-refresh', options.cardsRefresh)
  }
  if (options.pricesRefresh) {
    args.push('--prices-refresh', options.pricesRefresh)
  }
  const proc = Bun.spawn(args, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        RITUAL_CACHE_SERVER: '',
        RITUAL_CACHE_SERVER_CARDS_REFRESH: '',
        RITUAL_CACHE_SERVER_PRICES_REFRESH: '',
      },
    })
  const stdoutPromise = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve('')
  const stderrPromise = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve('')

  await waitForHealth(port)
  return {
    cwd,
    port,
    process: proc,
    stdoutPromise,
    stderrPromise,
  }
}

async function stopServer(server: RunningServer): Promise<StopServerOutput> {
  await Bun.sleep(100)
  server.process.kill()
  await Promise.race([server.process.exited, Bun.sleep(2000)])
  const [stdout, stderr] = await Promise.all([server.stdoutPromise, server.stderrPromise])
  await fs.rm(server.cwd, { recursive: true, force: true })
  return {
    stdout,
    stderr,
  }
}

describe('cache-server command (Integration)', () => {
  const runningServers: RunningServer[] = []

  afterEach(async () => {
    clearCacheServerAddressOverride()
    while (runningServers.length > 0) {
      const server = runningServers.pop()
      if (!server) break
      await stopServer(server)
    }
  })

  test('serves cached cards from local cache storage', async () => {
    const server = await startServer()
    runningServers.push(server)

    const response = await fetch(
      `http://127.0.0.1:${server.port}/cache/cards/${encodeURIComponent('Sol Ring')}`,
    )
    expect(response.status).toBe(200)

    const body = (await response.json()) as { value: ScryfallCard[] | null }
    expect(body.value).toBeArray()
    expect(body.value?.[0]?.name).toBe('Sol Ring')
  }, 20000)

  test('defaultCache uses cache-server when configured', async () => {
    const server = await startServer()
    runningServers.push(server)

    setCacheServerAddressOverride(`127.0.0.1:${server.port}`)

    const fetched = await defaultCache.get('Sol Ring')
    expect(fetched).toEqual(testPrice)

    await defaultCache.set('Arcane Signet', { latest: 2, min: 1, max: 3 })
    const response = await fetch(
      `http://127.0.0.1:${server.port}/cache/prices/${encodeURIComponent('Arcane Signet')}`,
    )
    const body = (await response.json()) as { value: PriceData | null }
    expect(body.value).toEqual({ latest: 2, min: 1, max: 3 })
  }, 20000)

  test('verbose mode logs every request', async () => {
    const server = await startServer({ verbose: true })

    const health = await fetch(`http://127.0.0.1:${server.port}/health`)
    expect(health.status).toBe(200)

    const read = await fetch(
      `http://127.0.0.1:${server.port}/cache/cards/${encodeURIComponent('Sol Ring')}`,
    )
    expect(read.status).toBe(200)

    const logs = await stopServer(server)
    expect(logs.stdout).toContain('[cache-server] GET /health -> 200')
    expect(logs.stdout).toContain('[cache-server] GET /cache/cards/Sol%20Ring -> 200')
  }, 20000)

  test('logs cache updates for write operations', async () => {
    const server = await startServer()

    const setResponse = await fetch(
      `http://127.0.0.1:${server.port}/cache/prices/${encodeURIComponent('Arcane Signet')}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: { latest: 2.1, min: 1.2, max: 3.4 } }),
      },
    )
    expect(setResponse.status).toBe(204)

    const deleteResponse = await fetch(
      `http://127.0.0.1:${server.port}/cache/prices/${encodeURIComponent('Arcane Signet')}`,
      {
        method: 'DELETE',
      },
    )
    expect(deleteResponse.status).toBe(204)

    const logs = await stopServer(server)
    expect(logs.stdout).toContain("cache update: section=prices action=set key='Arcane Signet'")
    expect(logs.stdout).toContain("cache update: section=prices action=delete key='Arcane Signet'")
  }, 20000)

  test('returns cache timestamps for keys and sections', async () => {
    const server = await startServer()
    runningServers.push(server)

    const timestampResponse = await fetch(
      `http://127.0.0.1:${server.port}/cache/cards/${encodeURIComponent('Sol Ring')}/timestamp`,
    )
    expect(timestampResponse.status).toBe(200)
    const timestampBody = (await timestampResponse.json()) as { timestamp: number | null }
    expect(typeof timestampBody.timestamp).toBe('number')

    const metadataResponse = await fetch(`http://127.0.0.1:${server.port}/cache/cards/metadata`)
    expect(metadataResponse.status).toBe(200)
    const metadataBody = (await metadataResponse.json()) as { timestamp: number | null }
    expect(typeof metadataBody.timestamp).toBe('number')
  }, 20000)

  test('streams price entries over SSE', async () => {
    const server = await startServer()
    runningServers.push(server)

    const response = await fetch(`http://127.0.0.1:${server.port}/cache/prices/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: ['Sol Ring', 'Arcane Signet'] }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const body = await response.text()
    expect(body).toContain('event: price')
    expect(body).toContain('"key":"Sol Ring"')
    expect(body).toContain('"key":"Arcane Signet"')
    expect(body).toContain('"updated":false')
    expect(body).toContain('event: done')
  }, 20000)

  test('defaultCache streams entries from cache-server', async () => {
    const server = await startServer()
    runningServers.push(server)

    setCacheServerAddressOverride(`127.0.0.1:${server.port}`)
    const streamed: string[] = []

    const values = await defaultCache.streamGetMany(['Sol Ring', 'Arcane Signet'], (key) => {
      streamed.push(key)
    })

    expect(values['Sol Ring']).toEqual(testPrice)
    expect(values['Arcane Signet']).toEqual(testPrice2)
    expect(streamed).toEqual(['Sol Ring', 'Arcane Signet'])
  }, 20000)

  test('accepts distinct cards and prices refresh options', async () => {
    const server = await startServer({ cardsRefresh: 'monthly', pricesRefresh: 'weekly' })
    const logs = await stopServer(server)
    expect(logs.stdout).toContain('Scheduled cards cache refresh enabled: monthly')
    expect(logs.stdout).toContain('Scheduled prices cache refresh enabled: weekly')
  }, 20000)

  test('deck pricing defaults to stream endpoint with cache server', async () => {
    const server = await startServer({ verbose: true })

    setCacheServerAddressOverride(`127.0.0.1:${server.port}`)
    const service = new PriceService(
      {
        fetchLatestPrices: async () => new Map(),
        fetchMinMaxPrice: async () => ({ min: 0, max: 0 }),
      },
      defaultCache,
    )

    await service.getDeckPricing([
      { name: 'Sol Ring', quantity: 1 },
      { name: 'Arcane Signet', quantity: 1 },
    ])

    const logs = await stopServer(server)
    expect(logs.stdout).toContain('[cache-server] POST /cache/prices/stream -> 200')
    expect(logs.stdout).not.toContain('[cache-server] GET /cache/prices/Sol%20Ring -> 200')
    expect(logs.stdout).not.toContain('[cache-server] GET /cache/prices/Arcane%20Signet -> 200')
  }, 20000)
})
