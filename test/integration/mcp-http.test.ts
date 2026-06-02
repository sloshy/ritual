import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getBaseDir, setBaseDir } from '../../src/base-dir'
import { initRitualConfig, resetRitualConfigCache } from '../../src/ritual-config'
import { runHttpServer } from '../../src/mcp/run'

const TOKEN = 'integration-secret'

type ToolText = { content: { type: string; text?: string }[] }

function text(result: unknown): string {
  return (result as ToolText).content[0]?.text ?? ''
}

function endpoint(server: Server): URL {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return new URL(`http://127.0.0.1:${port}/mcp`)
}

describe('ritual mcp (streamable HTTP)', () => {
  let originalBase: string
  let dir: string
  let server: Server

  // No Scryfall fetch stub here on purpose: these tests exercise the HTTP transport
  // (the real client uses global fetch to reach the loopback server) and only call
  // tools that don't load card data, so no network is hit.
  beforeEach(async () => {
    originalBase = getBaseDir()
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ritual-mcp-http-'))
    await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'decks', 'starter.md'),
      '---\nname: "Starter"\n---\n\n# Starter\n\n1 Sol Ring &1\n',
    )
    setBaseDir(dir)
    resetRitualConfigCache()
    await initRitualConfig()
    server = await runHttpServer({ port: 0, host: '127.0.0.1', token: TOKEN })
  })

  afterEach(async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    setBaseDir(originalBase)
    resetRitualConfigCache()
    await fs.rm(dir, { recursive: true, force: true })
  })

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

  test('returns 401 for a request without the bearer token', async () => {
    const res = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    expect(res.status).toBe(401)
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
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const res = await fetch(`http://127.0.0.1:${port}/nope`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })
})
