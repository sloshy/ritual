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
  'export_cards',
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

type ConfigView = {
  site?: { bannedPrintings?: string[] }
  defaultCurrency?: string
  cacheLockTimeoutSeconds?: number
  cacheSource?: string
  cacheFeedUrl?: string
}

type AcceptedConfigUpdate = {
  label: string
  update: Record<string, unknown>
  read: (config: ConfigView) => unknown
  expected: unknown
}

type RejectedConfigUpdate = {
  label: string
  update: Record<string, unknown>
}

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

  test('export_cards renders the selected list with chosen columns', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ type: 'deck', name: 'test-deck' }],
      format: 'csv',
      columns: ['name', 'quantity', 'section'],
      quoteAll: true,
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { entryCount: number; content: string; warnings: string[] }
    expect(data.entryCount).toBe(2)
    expect(data.content.split('\n')).toEqual([
      '"Name","Quantity","Section"',
      '"Sol Ring","1","Commander"',
      '"Lightning Bolt","1","Main"',
    ])
  })

  test('export_cards rejects an unknown list with a clear error', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ name: 'nope' }],
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('nope')
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
    // CSV parsing/append/failure semantics are owned by the admin handler tests
    // in test/unit/admin/import-csv.test.ts; this pins the MCP wiring.
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

  test('import_changes applies a change bundle to the target lists', async () => {
    // Apply semantics (retargeting, conflicts, partial failures) are owned by
    // test/unit/import-changes.test.ts and test/integration/import-changes.test.ts,
    // which exercise the same applyChangeBundle engine; this pins the MCP wiring
    // and the per-list result shape.
    const bundle = {
      format: 'ritual-change-bundle',
      version: 1,
      exportedAt: '2026-06-04T00:00:00.000Z',
      lists: [
        {
          kind: 'deck',
          slug: 'test-deck',
          name: 'Test Deck',
          changes: [{ id: 'a1', timestamp: 1, action: 'add', cardName: 'Counterspell' }],
        },
        {
          kind: 'wanted',
          slug: 'wishlist',
          name: 'Wishlist',
          changes: [{ id: 'a2', timestamp: 2, action: 'add', cardName: 'Brainstorm' }],
        },
      ],
    }
    const result = await callTool(client, 'import_changes', { json: JSON.stringify(bundle) })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      success: boolean
      lists: { slug: string; applied: number }[]
    }
    expect(data.success).toBe(true)
    expect(data.lists.map((l) => l.applied)).toEqual([1, 1])

    const deckOnDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deckOnDisk).toMatch(/Counterspell &\d+/)
  })

  test('import_changes rejects malformed JSON with a clear error', async () => {
    // Pins the tool's local pre-validation branch (bundle parse failures are
    // covered in test/unit/change-bundle.test.ts; the isError mapping is not).
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

  test('update_config accepts valid values and get_config returns them normalized', async () => {
    // Per-key validation semantics are owned by the ritual-config/config-set unit
    // tests; this pins the MCP wiring (handler dispatch + persisted round-trip).
    const cases: AcceptedConfigUpdate[] = [
      {
        label: 'bannedPrintings (set codes lowercased)',
        update: { site: { bannedPrintings: ['SLD:123', 'mh2:42'] } },
        read: (config) => config.site?.bannedPrintings,
        expected: ['sld:123', 'mh2:42'],
      },
      {
        label: 'defaultCurrency (case normalized)',
        update: { defaultCurrency: 'EUR' },
        read: (config) => config.defaultCurrency,
        expected: 'eur',
      },
      {
        label: 'cacheLockTimeoutSeconds',
        update: { cacheLockTimeoutSeconds: 120 },
        read: (config) => config.cacheLockTimeoutSeconds,
        expected: 120,
      },
      {
        label: 'cacheSource',
        update: { cacheSource: 'feed' },
        read: (config) => config.cacheSource,
        expected: 'feed',
      },
      {
        label: 'cacheFeedUrl',
        update: { cacheFeedUrl: 'https://feed.example/feed.json' },
        read: (config) => config.cacheFeedUrl,
        expected: 'https://feed.example/feed.json',
      },
    ]

    for (const { label, update, read, expected } of cases) {
      const updated = await callTool(client, 'update_config', { config: update })
      expect({ label, isError: updated.isError ?? false }).toEqual({ label, isError: false })

      const got = toolJson(await callTool(client, 'get_config', {})) as { config: ConfigView }
      expect({ label, value: read(got.config) }).toEqual({ label, value: expected })
    }
  })

  test('update_config rejects invalid values with an isError result', async () => {
    const cases: RejectedConfigUpdate[] = [
      {
        label: 'malformed bannedPrintings entry',
        update: { site: { bannedPrintings: ['not-a-printing'] } },
      },
      { label: 'invalid defaultCurrency', update: { defaultCurrency: 'gbp' } },
      { label: 'non-positive cacheLockTimeoutSeconds', update: { cacheLockTimeoutSeconds: 0 } },
      { label: 'invalid cacheSource', update: { cacheSource: 'torrent' } },
      {
        label: 'non-http(s) cacheFeedUrl',
        update: { cacheFeedUrl: 'ftp://feed.example/feed.json' },
      },
    ]

    for (const { label, update } of cases) {
      const result = await callTool(client, 'update_config', { config: update })
      expect({ label, isError: result.isError }).toEqual({ label, isError: true })
    }
  })

  test('update_config clears an existing cacheFeedUrl with an empty string', async () => {
    const set = await callTool(client, 'update_config', {
      config: { cacheFeedUrl: 'https://feed.example/feed.json' },
    })
    expect(set.isError).toBeFalsy()

    const cleared = await callTool(client, 'update_config', {
      config: { cacheFeedUrl: '' },
    })
    expect(cleared.isError).toBeFalsy()

    const got = toolJson(await callTool(client, 'get_config', {})) as {
      config: { cacheFeedUrl?: string }
    }
    expect(got.config.cacheFeedUrl).toBeUndefined()
  })
})
