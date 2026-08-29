import { describe, expect, test } from 'bun:test'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { expectStructuredOnly, toolData } from '../mcp-test-utils'
import { binaryPath, ensureBinary, withTempDir } from './helpers/cli'
import { writeDeckFile } from '../helpers/workspace'

type ListsResult = { lists: { slug: string }[] }

function listSlugs(result: CallToolResult): string[] {
  return toolData<ListsResult>(result).lists.map((l) => l.slug)
}

describe('ritual mcp (stdio)', () => {
  test('serves the MCP protocol over stdio against a temp base dir', async () => {
    await ensureBinary()
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'starter', {
        name: 'Starter',
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })

      const transport = new StdioClientTransport({
        command: binaryPath,
        args: ['mcp', '--base-dir', dir],
        stderr: 'ignore',
      })
      const client = new Client({ name: 'it-stdio', version: '0.0.0' })
      // A successful connect proves the JSON-RPC handshake survived the compiled
      // binary — i.e. stdout carried only protocol frames (no log pollution).
      await client.connect(transport)
      try {
        // This test IS the legacy-leg coverage: pin the era so an SDK default
        // flip to modern negotiation cannot silently retire it.
        expect(client.getProtocolEra()).not.toBe('modern')
        // Stdio pins one server instance per connection, so it is the only
        // transport that can deliver resources/list_changed — and therefore the
        // only one that advertises it. (The HTTP leg builds a server per
        // request; see test/integration/mcp-http.test.ts.)
        expect(client.getServerCapabilities()?.resources).toEqual({
          listChanged: true,
          subscribe: false,
        })
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain('list_lists')

        const listed = await client.callTool({ name: 'list_lists', arguments: {} })
        // The one thing only a transport test can cover: `structuredContent`
        // survives the wire, and a success still carries no duplicate text.
        expectStructuredOnly(listed)
        expect(listSlugs(listed)).toContain('starter')

        // A network-free write, proving an end-to-end mutation round-trip.
        const created = await client.callTool({
          name: 'create_list',
          arguments: { listType: 'deck', name: 'Made By MCP' },
        })
        expect(toolData<{ slug: string }>(created).slug).toBe('Made By MCP')

        const after = await client.callTool({ name: 'list_lists', arguments: {} })
        expect(listSlugs(after)).toContain('Made By MCP')
      } finally {
        await client.close()
      }
    })
  }, 120_000)

  test('serves a 2026-07-28 client over stdio from the compiled binary', async () => {
    await ensureBinary()
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'starter', {
        name: 'Starter',
        cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
      })

      const transport = new StdioClientTransport({
        command: binaryPath,
        args: ['mcp', '--base-dir', dir],
        stderr: 'ignore',
      })
      // `serveStdio`'s modern leg is new code on the stdio path, and this is the
      // only coverage that it survives `bun build --compile`.
      const client = new Client(
        { name: 'it-stdio-modern', version: '0.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      )
      await client.connect(transport)
      try {
        expect(client.getProtocolEra()).toBe('modern')
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain('list_lists')

        // Not just a catalogue read: the modern codec has its own result
        // envelope, so run a call through it and check the structured-only
        // contract holds there too — the legacy leg above proves nothing about it.
        const listed = await client.callTool({ name: 'list_lists', arguments: {} })
        expectStructuredOnly(listed)
        expect(listSlugs(listed)).toContain('starter')
      } finally {
        await client.close()
      }
    })
  }, 120_000)
})
