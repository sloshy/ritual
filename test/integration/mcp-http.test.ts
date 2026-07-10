import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { runHttpServer } from '../../src/mcp/run'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'

const TOKEN = 'integration-secret'

type ToolText = { content: { type: string; text?: string }[] }

function text(result: unknown): string {
  return (result as ToolText).content[0]?.text ?? ''
}

function serverBase(server: Server): string {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return `http://127.0.0.1:${port}`
}

function endpoint(server: Server): URL {
  return new URL(`${serverBase(server)}/mcp`)
}

// No Scryfall fetch stub on purpose: these tests exercise the HTTP transport (the
// real client uses global fetch to reach the loopback server) and only call tools
// that don't load card data, so no network is hit.
async function makeWorkspace(): Promise<BoundWorkspace> {
  const ws = await bindWorkspace({ dirs: ['decks'], config: false, init: true })
  await writeDeckFile(ws.dir, 'starter', {
    frontMatter: { name: 'Starter' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  return ws
}

async function teardown(ws: BoundWorkspace, server: Server): Promise<void> {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await ws.dispose()
}

describe('ritual mcp HTTP — bearer auth', () => {
  let ws: BoundWorkspace
  let server: Server

  beforeEach(async () => {
    ws = await makeWorkspace()
    server = await runHttpServer({
      port: 0,
      host: '127.0.0.1',
      auth: { kind: 'bearer', token: TOKEN },
    })
  })
  afterEach(async () => teardown(ws, server))

  test('drives the protocol over HTTP with a valid bearer token', async () => {
    const transport = new StreamableHTTPClientTransport(endpoint(server), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    })
    const client = new Client({ name: 'it-http', version: '0.0.0' })
    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('list_decks')

      const listed = await client.callTool({ name: 'list_decks', arguments: {} })
      expect(text(listed)).toContain('starter')
    } finally {
      await client.close()
    }
  })

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
  })

  test('returns 400 for a POST without a session before initialize', async () => {
    const res = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 404 for a non-/mcp path', async () => {
    const res = await fetch(`${serverBase(server)}/nope`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })
})

describe('ritual mcp HTTP — no auth', () => {
  let ws: BoundWorkspace
  let server: Server

  beforeEach(async () => {
    ws = await makeWorkspace()
    server = await runHttpServer({ port: 0, host: '127.0.0.1', auth: { kind: 'none' } })
  })
  afterEach(async () => teardown(ws, server))

  test('serves requests without any auth header', async () => {
    const transport = new StreamableHTTPClientTransport(endpoint(server))
    const client = new Client({ name: 'it-http-noauth', version: '0.0.0' })
    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('list_decks')
    } finally {
      await client.close()
    }
  })
})
