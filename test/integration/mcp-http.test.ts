import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  runHttpServer,
  NOT_FOUND_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type McpHttpServer,
  type RpcErrorBody,
} from '../../src/mcp/run'
import type { Progress } from '@modelcontextprotocol/client'
import { expectStructuredOnly, toolData } from '../mcp-test-utils'
import { expectMonotonicProgress } from '../test-utils'
import { stubScryfallBulk } from './helpers/scryfall-bulk'
import type { StubbedFetch } from './helpers/stub-fetch'

/** `list_lists`' result, as far as this transport check reads it. */
type ListsResult = { lists: { slug: string }[] }
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'
import { runCli, withTempDir } from './helpers/cli'

const TOKEN = 'integration-secret'

function serverBase(server: McpHttpServer): string {
  return `http://127.0.0.1:${server.port}`
}

function endpoint(server: McpHttpServer): URL {
  return new URL(`${serverBase(server)}/mcp`)
}

/** The JSON-RPC error envelope Ritual answers its own pre-transport rejections with. */
async function rpcErrorCode(response: Response): Promise<number | undefined> {
  const body = (await response.json()) as RpcErrorBody
  return body.error?.code
}

// No Scryfall fetch stub on purpose: these tests exercise the HTTP transport (the
// real client uses global fetch to reach the loopback server) and only call tools
// that don't load card data (list_lists reads list files only), so no network is hit.
async function makeWorkspace(): Promise<BoundWorkspace> {
  const ws = await bindWorkspace({ dirs: ['decks'], config: false, init: true })
  await writeDeckFile(ws.dir, 'starter', {
    frontMatter: { name: 'Starter' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  return ws
}

/** `refresh_cache`'s result, as far as the progress tests read it. */
type CacheRefreshData = { message: string }

async function teardown(ws: BoundWorkspace, server: McpHttpServer): Promise<void> {
  // `runHttpServer` wraps stop() so this also tears the MCP handler down.
  await server.stop(true)
  await ws.dispose()
}

/**
 * Connect a client to `server`, run `body`, and close it whatever happens.
 *
 * Every block below opened with the same four lines (transport, client,
 * connect, `try`/`finally { client.close() }`); a block that forgot the
 * `finally` leaked a connection into the next test's server teardown.
 */
async function withClient(
  server: McpHttpServer,
  name: string,
  body: (client: Client) => Promise<void>,
  options?: { requestInit?: RequestInit; clientOptions?: ConstructorParameters<typeof Client>[1] },
): Promise<void> {
  const transport = new StreamableHTTPClientTransport(endpoint(server), {
    requestInit: options?.requestInit,
  })
  const client = new Client({ name, version: '0.0.0' }, options?.clientOptions)
  await client.connect(transport)
  try {
    await body(client)
  } finally {
    await client.close()
  }
}

describe('ritual mcp HTTP — bearer auth', () => {
  let ws: BoundWorkspace
  let server: McpHttpServer

  beforeEach(async () => {
    ws = await makeWorkspace()
    server = await runHttpServer({
      port: 0,
      host: '127.0.0.1',
      auth: { kind: 'bearer', token: TOKEN },
    })
  })
  afterEach(async () => teardown(ws, server))

  // The two eras are different code paths end to end (per-request envelope,
  // Mcp-Method/Mcp-Name headers, no session on the modern leg; the legacy
  // stateless fallback on the 2025 leg). Each leg asserts its own era so a
  // future SDK default flip cannot silently collapse them onto one path.
  const eras = [
    { label: '2025-era', options: undefined, modern: false },
    {
      label: '2026-07-28',
      options: { versionNegotiation: { mode: 'auto' as const } },
      modern: true,
    },
  ]
  for (const { label, options, modern } of eras) {
    test(`drives the protocol over HTTP as a ${label} client`, async () => {
      await withClient(
        server,
        `it-http-${label}`,
        async (client) => {
          if (modern) {
            expect(client.getProtocolEra()).toBe('modern')
          } else {
            expect(client.getProtocolEra()).not.toBe('modern')
          }
          // This leg builds one server instance per request and tears it down with
          // the response, so a resources/list_changed notification would have no
          // connection to reach — it must not claim the capability. (Stdio does;
          // see test/integration/mcp-stdio.test.ts.)
          expect(client.getServerCapabilities()?.resources).toEqual({
            listChanged: false,
            subscribe: false,
          })
          const { tools } = await client.listTools()
          expect(tools.map((t) => t.name)).toContain('list_lists')

          const listed = await client.callTool({ name: 'list_lists', arguments: {} })
          // `structuredContent` must survive this transport in both eras — the one
          // property only a transport test can pin.
          expectStructuredOnly(listed)
          expect(toolData<ListsResult>(listed).lists.map((l) => l.slug)).toContain('starter')
        },
        { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }, clientOptions: options },
      )
    })
  }

  test('returns 401 for a request with a missing or wrong bearer token', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })

    const missing = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body,
    })
    expect(missing.status).toBe(401)
    expect(await rpcErrorCode(missing)).toBe(UNAUTHORIZED_ERROR_CODE)

    const wrong = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer wrong-token',
      },
      body,
    })
    expect(wrong.status).toBe(401)
    expect(await rpcErrorCode(wrong)).toBe(UNAUTHORIZED_ERROR_CODE)
  })

  test('serves a bare tools/list POST with no initialize and no session', async () => {
    // Serving is stateless now: what used to be a 400 ("send an initialize
    // request first") is the ordinary way to call the server.
    const res = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(200)
    // The stateless invariant on the wire: no session is minted, ever.
    expect(res.headers.get('mcp-session-id')).toBeNull()
    expect(await res.text()).toContain('list_lists')
  })

  test('returns 405 for the legacy standalone SSE stream and session teardown', async () => {
    // GET /mcp and DELETE /mcp are 2025 session operations; stateless serving
    // has no sessions, and Ritual uses neither feature.
    const get = await fetch(endpoint(server), {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
      },
    })
    expect(get.status).toBe(405)

    const del = await fetch(endpoint(server), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(del.status).toBe(405)
  })

  test('rejects a foreign Host header on a loopback bind (DNS rebinding)', async () => {
    // Host validation runs before auth on loopback binds; a rebinding page
    // reaches 127.0.0.1 under its own hostname and must be turned away.
    const res = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
        Host: 'evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(403)
  })

  test('rejects a non-local Origin header on a loopback bind', async () => {
    const res = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
        Origin: 'http://evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(403)
  })

  test('returns 415 for a POST that is not application/json', async () => {
    const res = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(415)
  })

  test('returns 404 for a non-/mcp path', async () => {
    const res = await fetch(`${serverBase(server)}/nope`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
    expect(await rpcErrorCode(res)).toBe(NOT_FOUND_ERROR_CODE)
  })
})

describe('ritual mcp HTTP — no auth', () => {
  let ws: BoundWorkspace
  let server: McpHttpServer

  beforeEach(async () => {
    ws = await makeWorkspace()
    server = await runHttpServer({ port: 0, host: '127.0.0.1', auth: { kind: 'none' } })
  })
  afterEach(async () => teardown(ws, server))

  test('serves requests without any auth header', async () => {
    await withClient(server, 'it-http-noauth', async (client) => {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('list_lists')
    })
  })
})

describe('ritual mcp HTTP — in-call progress notifications', () => {
  let ws: BoundWorkspace
  let server: McpHttpServer
  let stubbed: StubbedFetch

  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: ['decks'], config: false, init: true, clearCardCache: true })
    server = await runHttpServer({ port: 0, host: '127.0.0.1', auth: { kind: 'none' } })
    // Passthrough: the SDK client reaches the loopback server started above over
    // this same `globalThis.fetch`, so unrouted requests must not be refused.
    stubbed = stubScryfallBulk({ passthrough: true })
  })
  afterEach(async () => {
    stubbed.restore()
    await teardown(ws, server)
  })

  test('a call supplying a progressToken receives progress and still gets its result', async () => {
    await withClient(
      server,
      'it-http-progress',
      async (client) => {
        const received: Progress[] = []
        const result = await client.callTool(
          { name: 'refresh_cache', arguments: {} },
          {
            onprogress: (progress) => received.push(progress),
            // The SDK's default request timeout is 60s and does not reset on
            // progress; a refresh is short here, but the flag is what a real
            // client driving a long tool must set.
            resetTimeoutOnProgress: true,
          },
        )

        // The emission path, the stateless leg's automatic SSE upgrade, and the
        // unchanged blocking result — one call covers all three.
        expectMonotonicProgress(received, 100)
        // And the run reaches the end of its own scale: a bar that stops at 99
        // is a run the client never learns finished.
        expect(received.at(-1)?.progress).toBe(100)
        expectStructuredOnly(result)
        expect(toolData<CacheRefreshData>(result).message).toBe('Cache refreshed successfully')
      },
      { clientOptions: { versionNegotiation: { mode: 'auto' } } },
    )
  })

  test('a call without onprogress receives no progress notifications', async () => {
    await withClient(
      server,
      'it-http-no-progress',
      async (client) => {
        const received: unknown[] = []
        client.setNotificationHandler('notifications/progress', (notification) => {
          received.push(notification)
        })

        const result = await client.callTool({ name: 'refresh_cache', arguments: {} })

        // No token was stamped, so the server emitted nothing — the "only when
        // the client asked" half of the contract.
        expect(received).toEqual([])
        expect(toolData<CacheRefreshData>(result).message).toBe('Cache refreshed successfully')
      },
      { clientOptions: { versionNegotiation: { mode: 'auto' } } },
    )
  })
})

describe('ritual mcp CLI flag gate', () => {
  test('refuses tokenless HTTP on a non-loopback host with exit code 2', async () => {
    await withTempDir(async (dir) => {
      const result = await runCli(['mcp', '--transport', 'http', '--host', '0.0.0.0'], dir, {
        RITUAL_MCP_TOKEN: undefined,
      })
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('Refusing to serve MCP without authentication')
    })
  })

  test('--allow-unauthenticated is accepted by the option parser', async () => {
    await withTempDir(async (dir) => {
      // An invalid port keeps the command from actually binding a server; the
      // parse error proves --allow-unauthenticated itself was not rejected.
      const result = await runCli(
        ['mcp', '--transport', 'http', '--host', '0.0.0.0', '--allow-unauthenticated', '-p', '0'],
        dir,
        { RITUAL_MCP_TOKEN: undefined },
      )
      expect(result.exitCode).toBe(2)
      expect(result.stderr).not.toContain('Refusing to serve MCP')
      expect(result.stderr).toContain('Port must be an integer between 1 and 65535')
    })
  })
})
