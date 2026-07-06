import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { buildMcpServer } from '../../../src/mcp/server'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

const EXPECTED_TOOLS = [
  // read
  'list_decks',
  'list_collections',
  'list_wanted',
  'list_all_lists',
  'load_deck',
  'load_collection',
  'load_wanted',
  'search_cards',
  'autocomplete_card',
  'card_printings',
  'card_price',
  'load_history',
  'move_candidates',
  'get_config',
  'get_audit_log',
  // write
  'create_deck',
  'create_collection',
  'create_wanted',
  'import_deck',
  'import_csv',
  'import_changes',
  'add_card_to_deck',
  'remove_card_from_deck',
  'add_card_to_collection',
  'add_card_to_wanted',
  'set_card_note',
  'set_card_printing',
  'set_commander',
  'move_cards',
  // destructive
  'rename_deck',
  'rename_collection',
  'rename_wanted',
  'delete_deck',
  'delete_collection',
  'delete_wanted',
  'rewrite_history',
  'update_config',
  'build_site',
  'refresh_cache',
]

function firstText(result: CallToolResult): string {
  const block = result.content[0]
  return block && block.type === 'text' ? block.text : ''
}

function toolJson(result: CallToolResult): unknown {
  return JSON.parse(firstText(result))
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult
}

describe('Ritual MCP server (in-memory transport)', () => {
  let env: RitualTestEnv
  let client: Client

  beforeEach(async () => {
    env = await setupRitualTestEnv()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await buildMcpServer().connect(serverTransport)
    client = new Client({ name: 'ritual-test', version: '0.0.0' })
    await client.connect(clientTransport)
  })

  afterEach(async () => {
    await client.close()
    await env.cleanup()
  })

  test('negotiates capabilities and server identity on initialize', () => {
    expect(client.getServerVersion()?.name).toBe('ritual')
    const caps = client.getServerCapabilities()
    expect(caps?.tools).toBeDefined()
    expect(caps?.resources).toBeDefined()
  })

  test('lists the full tool catalogue with valid input schemas', async () => {
    const { tools } = await client.listTools()
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(EXPECTED_TOOLS))

    const loadDeck = tools.find((t) => t.name === 'load_deck')
    expect(loadDeck?.inputSchema.type).toBe('object')
    expect(loadDeck?.inputSchema.required).toContain('slug')

    // Mutation tools hide the content hash entirely — the agent never supplies one.
    const addCard = tools.find((t) => t.name === 'add_card_to_deck')
    const props = addCard?.inputSchema.properties ?? {}
    expect(Object.keys(props)).toContain('cardName')
    expect(Object.keys(props)).not.toContain('contentHash')
  })

  test('flags every data-destroying tool with destructiveHint', async () => {
    const { tools } = await client.listTools()
    const destructiveHinted = new Set(
      tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name),
    )

    // Renames, deletes, history rewrites, config/site/cache ops, plus the import
    // tools (deck/CSV can overwrite an existing list; changes can remove cards).
    expect(destructiveHinted).toEqual(
      new Set([
        'rename_deck',
        'rename_collection',
        'rename_wanted',
        'delete_deck',
        'delete_collection',
        'delete_wanted',
        'rewrite_history',
        'update_config',
        'build_site',
        'refresh_cache',
        'import_deck',
        'import_csv',
        'import_changes',
      ]),
    )

    // Purely additive edits stay unflagged.
    const addCard = tools.find((t) => t.name === 'add_card_to_deck')
    expect(addCard?.annotations?.destructiveHint).not.toBe(true)
  })

  test('list_decks returns the synthetic deck', async () => {
    const data = toolJson(await callTool(client, 'list_decks', {})) as {
      decks: { slug: string; name: string }[]
    }
    expect(data.decks.map((d) => d.slug)).toContain('test-deck')
  })

  test('load_deck returns the deck contents without the heavy card payload', async () => {
    const result = await callTool(client, 'load_deck', { slug: 'test-deck' })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      deck: { sections: { cards: { name: string }[] }[] }
      cards?: unknown
    }
    const names = data.deck.sections.flatMap((s) => s.cards.map((c) => c.name))
    expect(names).toContain('Sol Ring')
    expect(data.cards).toBeUndefined()
  })

  test('add_card_to_deck persists a new card (no content hash exposed)', async () => {
    const added = await callTool(client, 'add_card_to_deck', {
      slug: 'test-deck',
      cardName: 'Counterspell',
    })
    expect(added.isError).toBeFalsy()

    const reloaded = toolJson(await callTool(client, 'load_deck', { slug: 'test-deck' })) as {
      deck: { sections: { cards: { name: string }[] }[] }
    }
    const names = reloaded.deck.sections.flatMap((s) => s.cards.map((c) => c.name))
    expect(names).toContain('Counterspell')

    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    // The card must be written with a freshly allocated &N id (1 and 2 are taken).
    expect(onDisk).toMatch(/Counterspell &\d+/)
  })

  test('add_card_to_collection persists through the disk-rederiving save path', async () => {
    const added = await callTool(client, 'add_card_to_collection', {
      slug: 'shoebox',
      cardName: 'Llanowar Elves',
      set: 'LEB',
      collectorNumber: '203',
    })
    expect(added.isError).toBeFalsy()
    const onDisk = await fs.readFile(path.join(env.dir, 'collections', 'shoebox.md'), 'utf-8')
    expect(onDisk).toContain('Llanowar Elves')
    // Set codes are uppercased in markdown output.
    expect(onDisk).toContain('(LEB:203)')
  })

  test('remove_card_from_deck deletes the line at quantity zero', async () => {
    const removed = await callTool(client, 'remove_card_from_deck', {
      slug: 'test-deck',
      cardName: 'Lightning Bolt',
    })
    expect(removed.isError).toBeFalsy()
    const reloaded = toolJson(await callTool(client, 'load_deck', { slug: 'test-deck' })) as {
      deck: { sections: { cards: { name: string }[] }[] }
    }
    const names = reloaded.deck.sections.flatMap((s) => s.cards.map((c) => c.name))
    expect(names).not.toContain('Lightning Bolt')
    expect(names).toContain('Sol Ring')
  })

  test('import_csv creates a new list by default', async () => {
    const result = await callTool(client, 'import_csv', {
      listType: 'wanted',
      name: 'csv-wants',
      content: 'Name\nBrainstorm',
      columns: 'name=1',
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { success: boolean; cardCount: number }
    expect(data.success).toBe(true)
    expect(data.cardCount).toBe(1)

    const onDisk = await fs.readFile(path.join(env.dir, 'wanted', 'csv-wants.md'), 'utf-8')
    expect(onDisk).toContain('- Brainstorm &1')
  })

  test('import_csv appends CSV rows to an existing collection', async () => {
    const result = await callTool(client, 'import_csv', {
      listType: 'collection',
      name: 'shoebox',
      mode: 'append',
      content: 'Name,Set,Collector Number,Quantity\nSol Ring,c19,221,2',
      columns: 'name=1,set=2,collector-number=3,quantity=4',
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { success: boolean; cardCount: number }
    expect(data.success).toBe(true)
    expect(data.cardCount).toBe(2)

    const onDisk = await fs.readFile(path.join(env.dir, 'collections', 'shoebox.md'), 'utf-8')
    expect(onDisk).toContain('- Sol Ring (C19:221) &1')
    expect(onDisk).toContain('- Sol Ring (C19:221) &2')
  })

  test('import_csv surfaces row failures as an error when nothing imports', async () => {
    const result = await callTool(client, 'import_csv', {
      listType: 'collection',
      name: 'csv-binder',
      content: 'Name,Set,Collector Number\nNo Printing,,',
      columns: 'name=1,set=2,collector-number=3',
    })
    expect(result.isError).toBe(true)
  })

  test('import_changes applies a multi-list bundle across list files', async () => {
    const bundle = {
      format: 'ritual-change-bundle',
      version: 1,
      exportedAt: '2026-06-04T00:00:00.000Z',
      lists: [
        {
          kind: 'deck',
          slug: 'test-deck',
          name: 'Test Deck',
          changes: [
            { id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' },
            { id: 'r1', timestamp: 2, action: 'remove', cardName: 'Lightning Bolt', cardId: 2 },
          ],
        },
        {
          kind: 'wanted',
          slug: 'wishlist',
          name: 'Wishlist',
          changes: [{ id: 'a2', timestamp: 3, action: 'add', cardName: 'Brainstorm' }],
        },
        // A list with no changes must be reported as applied: 0 without touching its file.
        { kind: 'collection', slug: 'shoebox', name: 'Shoebox', changes: [] },
      ],
    }
    const collectionBefore = await fs.readFile(
      path.join(env.dir, 'collections', 'shoebox.md'),
      'utf-8',
    )
    const result = await callTool(client, 'import_changes', { json: JSON.stringify(bundle) })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      success: boolean
      lists: { slug: string; applied: number; conflicts: unknown[] }[]
    }
    expect(data.success).toBe(true)
    expect(data.lists.map((l) => l.applied)).toEqual([2, 1, 0])

    const deckOnDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deckOnDisk).toMatch(/Counterspell &\d+/)
    expect(deckOnDisk).not.toContain('Lightning Bolt')
    const wantedOnDisk = await fs.readFile(path.join(env.dir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(wantedOnDisk).toMatch(/Brainstorm &\d+/)
    const collectionAfter = await fs.readFile(
      path.join(env.dir, 'collections', 'shoebox.md'),
      'utf-8',
    )
    expect(collectionAfter).toBe(collectionBefore)
  })

  test('import_changes reports unresolvable changes as skipped conflicts', async () => {
    const bundle = {
      format: 'ritual-change-bundle',
      version: 1,
      exportedAt: '2026-06-04T00:00:00.000Z',
      lists: [
        {
          kind: 'deck',
          slug: 'test-deck',
          name: 'Test Deck',
          changes: [
            { id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' },
            { id: 'r1', timestamp: 2, action: 'remove', cardName: 'Not In Deck', cardId: 99 },
          ],
        },
      ],
    }
    const result = await callTool(client, 'import_changes', { json: JSON.stringify(bundle) })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      success: boolean
      lists: { applied: number; conflicts: { change: { cardName: string } }[] }[]
    }
    expect(data.success).toBe(true)
    expect(data.lists[0]?.applied).toBe(1)
    expect(data.lists[0]?.conflicts.map((c) => c.change.cardName)).toEqual(['Not In Deck'])
  })

  test('import_changes reports a missing list without failing the rest of the bundle', async () => {
    const bundle = {
      format: 'ritual-change-bundle',
      version: 1,
      exportedAt: '2026-06-04T00:00:00.000Z',
      lists: [
        {
          kind: 'collection',
          slug: 'no-such-collection',
          name: 'Ghost',
          changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Sol Ring' }],
        },
        {
          kind: 'wanted',
          slug: 'wishlist',
          name: 'Wishlist',
          changes: [{ id: 'a2', timestamp: 2, action: 'add', cardName: 'Brainstorm' }],
        },
      ],
    }
    // The bundle partially fails, so the tool surfaces an error result — but the
    // valid list must still have been applied on disk.
    const result = await callTool(client, 'import_changes', { json: JSON.stringify(bundle) })
    expect(result.isError).toBe(true)
    const wantedOnDisk = await fs.readFile(path.join(env.dir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(wantedOnDisk).toContain('Brainstorm')
  })

  test('import_changes rejects malformed JSON with a clear error', async () => {
    const result = await callTool(client, 'import_changes', { json: '{"format":"other"}' })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Invalid change bundle')
  })

  test('add_card_to_wanted persists through the entry-serializing save path', async () => {
    const added = await callTool(client, 'add_card_to_wanted', {
      slug: 'wishlist',
      cardName: 'Brainstorm',
    })
    expect(added.isError).toBeFalsy()
    const onDisk = await fs.readFile(path.join(env.dir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(onDisk).toContain('Brainstorm')
  })

  test('returns an isError result for a missing list', async () => {
    const result = await callTool(client, 'load_deck', { slug: 'no-such-deck' })
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('not found')
  })

  test('rejects invalid arguments before reaching the handler', async () => {
    const result = await callTool(client, 'add_card_to_deck', {})
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
  })

  test('exposes lists as readable resources', async () => {
    const { resources } = await client.listResources()
    const uris = resources.map((r) => r.uri)
    expect(uris).toContain('ritual://deck/test-deck')

    const read = await client.readResource({ uri: 'ritual://deck/test-deck' })
    const entry = read.contents[0]
    expect(entry?.uri).toBe('ritual://deck/test-deck')
    expect(entry?.mimeType).toBe('application/json')
    const text = entry && 'text' in entry ? entry.text : ''
    const parsed = JSON.parse(String(text)) as { deck: { name: string } }
    expect(parsed.deck.name).toBe('Test Deck')
  })

  test('delete_deck enforces the confirmName guard', async () => {
    const wrong = await callTool(client, 'delete_deck', {
      slug: 'test-deck',
      confirmName: 'Wrong Name',
    })
    expect(wrong.isError).toBe(true)

    const right = await callTool(client, 'delete_deck', {
      slug: 'test-deck',
      confirmName: 'Test Deck',
    })
    expect(right.isError).toBeFalsy()

    const decks = toolJson(await callTool(client, 'list_decks', {})) as {
      decks: { slug: string }[]
    }
    expect(decks.decks.map((d) => d.slug)).not.toContain('test-deck')
  })

  test('update_config normalizes bannedPrintings and get_config returns them', async () => {
    const updated = await callTool(client, 'update_config', {
      config: { site: { bannedPrintings: ['SLD:123', 'mh2:42'] } },
    })
    expect(updated.isError).toBeFalsy()

    const got = toolJson(await callTool(client, 'get_config', {})) as {
      config: { site?: { bannedPrintings?: string[] } }
    }
    // The admin handler normalizes set codes to lowercase before persisting.
    expect(got.config.site?.bannedPrintings).toEqual(['sld:123', 'mh2:42'])
  })

  test('update_config rejects a malformed bannedPrintings entry', async () => {
    const result = await callTool(client, 'update_config', {
      config: { site: { bannedPrintings: ['not-a-printing'] } },
    })
    expect(result.isError).toBe(true)
  })

  test('update_config normalizes defaultCurrency case and get_config returns it', async () => {
    const updated = await callTool(client, 'update_config', {
      config: { defaultCurrency: 'EUR' },
    })
    expect(updated.isError).toBeFalsy()

    const got = toolJson(await callTool(client, 'get_config', {})) as {
      config: { defaultCurrency?: string }
    }
    expect(got.config.defaultCurrency).toBe('eur')
  })

  test('update_config rejects an invalid defaultCurrency', async () => {
    const result = await callTool(client, 'update_config', {
      config: { defaultCurrency: 'gbp' },
    })
    expect(result.isError).toBe(true)
  })

  test('update_config accepts a valid cacheLockTimeoutSeconds and get_config returns it', async () => {
    const updated = await callTool(client, 'update_config', {
      config: { cacheLockTimeoutSeconds: 120 },
    })
    expect(updated.isError).toBeFalsy()

    const got = toolJson(await callTool(client, 'get_config', {})) as {
      config: { cacheLockTimeoutSeconds?: number }
    }
    expect(got.config.cacheLockTimeoutSeconds).toBe(120)
  })

  test('update_config rejects a non-positive cacheLockTimeoutSeconds', async () => {
    const result = await callTool(client, 'update_config', {
      config: { cacheLockTimeoutSeconds: 0 },
    })
    expect(result.isError).toBe(true)
  })
})
