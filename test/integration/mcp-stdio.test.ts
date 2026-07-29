import { describe, expect, test } from 'bun:test'
import { Client, type CallToolResult } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { firstText, toolJson } from '../mcp-test-utils'
import { binaryPath, ensureBinary, withTempDir } from './helpers/cli'
import { writeDeckFile } from './helpers/workspace'

type ListsResult = { lists: { slug: string }[] }

function listSlugs(result: CallToolResult): string[] {
  return (toolJson(result) as ListsResult).lists.map((l) => l.slug)
}

describe('ritual mcp (stdio)', () => {
  test('serves the MCP protocol over stdio against a temp base dir', async () => {
    await ensureBinary()
    await withTempDir(async (dir) => {
      await writeDeckFile(dir, 'starter', {
        frontMatter: { name: 'Starter' },
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
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain('list_lists')

        const listed = await client.callTool({ name: 'list_lists', arguments: {} })
        expect(listSlugs(listed)).toContain('starter')

        // A network-free write, proving an end-to-end mutation round-trip.
        const created = await client.callTool({
          name: 'create_list',
          arguments: { listType: 'deck', name: 'Made By MCP' },
        })
        expect(firstText(created)).toContain('Made By MCP')

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
        frontMatter: { name: 'Starter' },
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
      } finally {
        await client.close()
      }
    })
  }, 120_000)
})
