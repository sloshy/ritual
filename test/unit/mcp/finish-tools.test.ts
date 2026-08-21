import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/client'
import { setupMcpClient, type McpTestSession } from './harness'
import { toolError } from '../../mcp-test-utils'

/**
 * Wiring-only coverage for the "a finish belongs to a printing" rule over MCP,
 * per the test layering policy: the rule itself is pinned on the three apply
 * engines (test/unit/{deck,collection,wanted}-changes.test.ts). What belongs
 * here is that a refusal reaches the agent as a tool error naming the reason,
 * and that the list is left untouched.
 */
describe('set-finish needs a printing, over MCP', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('finish-tools-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  test('apply_changes refuses foil on a name-only deck line and saves nothing', async () => {
    const deckPath = path.join(session.env.dir, 'decks', 'test-deck.md')
    const before = await fs.readFile(deckPath, 'utf-8')
    // The seeded deck's `1 Sol Ring &1` names no printing.
    expect(before).toContain('1 Sol Ring &1')

    const result = await client.callTool({
      name: 'apply_changes',
      arguments: {
        listType: 'deck',
        slug: 'test-deck',
        changes: [{ action: 'set-finish', cardName: 'Sol Ring', cardId: 1, finish: 'foil' }],
      },
    })

    const payload = toolError(result)
    expect(payload.message).toContain('set a finish on a card with no printing')
    expect(payload.message).toContain('Nothing was saved.')
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
  })

  test('set_card_printing cannot smuggle a foil token in by clearing the printing', async () => {
    const deckPath = path.join(session.env.dir, 'decks', 'test-deck.md')
    const before = await fs.readFile(deckPath, 'utf-8')

    // The tool documents omitting set/collectorNumber as "clear the printing" on
    // a deck — which must not become a second route to a printing-less `[foil]`.
    const result = await client.callTool({
      name: 'set_card_printing',
      arguments: {
        listType: 'deck',
        slug: 'test-deck',
        cardName: 'Sol Ring',
        cardId: 1,
        finish: 'foil',
      },
    })

    const payload = toolError(result)
    expect(payload.message).toContain('set a finish on a card with no printing')
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
  })
})
