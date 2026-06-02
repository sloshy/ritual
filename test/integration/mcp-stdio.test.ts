import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { binaryPath, ensureBinary, withTempDir } from './helpers/cli'

type ToolText = { content: { type: string; text?: string }[] }
type DeckList = { decks: { slug: string }[] }

function text(result: unknown): string {
  const block = (result as ToolText).content[0]
  return block?.text ?? ''
}

function deckSlugs(result: unknown): string[] {
  return (JSON.parse(text(result)) as DeckList).decks.map((d) => d.slug)
}

describe('ritual mcp (stdio)', () => {
  test('serves the MCP protocol over stdio against a temp base dir', async () => {
    await ensureBinary()
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, 'decks'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'decks', 'starter.md'),
        '---\nname: "Starter"\n---\n\n# Starter\n\n1 Sol Ring &1\n',
      )

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
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain('list_decks')

        const listed = await client.callTool({ name: 'list_decks', arguments: {} })
        expect(deckSlugs(listed)).toContain('starter')

        // A network-free write, proving an end-to-end mutation round-trip.
        const created = await client.callTool({
          name: 'create_deck',
          arguments: { name: 'Made By MCP' },
        })
        expect(text(created)).toContain('Made By MCP')

        const after = await client.callTool({ name: 'list_decks', arguments: {} })
        expect(deckSlugs(after)).toContain('Made By MCP')
      } finally {
        await client.close()
      }
    })
  }, 120_000)
})
