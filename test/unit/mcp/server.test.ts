import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { cardCache } from '../../../src/cache'
import { CSV_UPLOAD_THRESHOLD } from '../../../src/collection-sync/csv'
import { NEVER_CACHE, STATIC_CATALOG_CACHE } from '../../../src/mcp/cache-hints'
import { DECK_ONLY_FORMAT_MESSAGE } from '../../../src/mcp/schemas'
import { buildMcpServer } from '../../../src/mcp/server'
import { expectSchemaRejection, firstText, toolJson } from '../../mcp-test-utils'
import { makeScryfallCard } from '../../test-utils'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

// In registration order (read → write → destructive, as server.ts registers
// them) — the catalogue test asserts ordered equality to pin `tools/list`
// determinism, so this list must track the registration sequence exactly.
const EXPECTED_TOOLS = [
  // read
  'list_lists',
  'deck_sync_status',
  'collection_sync_status',
  'load_list',
  'search_cards',
  'autocomplete_card',
  'card_printings',
  'card_price',
  'price_report',
  'load_history',
  'get_config',
  'get_audit_log',
  'diff_lists',
  'export_cards',
  // write
  'create_list',
  'import_deck',
  'import_csv',
  'import_changes',
  'add_card',
  'remove_card',
  'set_card_note',
  'set_card_printing',
  'set_card_section',
  'set_commander',
  'unset_commander',
  'apply_changes',
  'move_cards',
  'remove_cards',
  // destructive
  'rename_list',
  'delete_list',
  'rewrite_history',
  'update_config',
  'build_site',
  'sync_decks',
  'sync_collection',
  'refresh_cache',
]

/** Mutation tools whose schemas must never surface the internally-managed content hash. */
const MUTATION_TOOLS = [
  'add_card',
  'remove_card',
  'set_card_note',
  'set_card_printing',
  'set_card_section',
  'set_commander',
  'unset_commander',
  'apply_changes',
  'move_cards',
  'remove_cards',
]

type ConfigView = {
  defaultCurrency?: string
}

type LoadedDeck = {
  deck: { sections: { name: string; cards: { name: string }[] }[] }
  cards?: unknown
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return await client.callTool({ name, arguments: args })
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

  async function loadDeck(slug: string): Promise<LoadedDeck> {
    return toolJson(await callTool(client, 'load_list', { listType: 'deck', slug })) as LoadedDeck
  }

  function deckCardNames(data: LoadedDeck): string[] {
    return data.deck.sections.flatMap((s) => s.cards.map((c) => c.name))
  }

  test('negotiates capabilities and server identity on initialize', () => {
    // This suite is the legacy-leg coverage: InMemoryTransport links 2025-era
    // instances, so pin the era in code — if the SDK's default negotiation ever
    // flips to modern, this suite would silently stop covering the legacy path.
    expect(client.getProtocolEra()).not.toBe('modern')
    expect(client.getServerVersion()?.name).toBe('ritual')
    const caps = client.getServerCapabilities()
    // Ritual never sends list-changed notifications and supports no resource
    // subscriptions, so it must not advertise either (the SDK defaults
    // `listChanged` to true for every declared capability).
    expect(caps?.tools).toEqual({ listChanged: false })
    expect(caps?.resources).toEqual({ listChanged: false, subscribe: false })
  })

  test('lists the full tool catalogue in registration order with valid input schemas', async () => {
    const { tools } = await client.listTools()
    // Ordered equality on purpose: the spec asks servers to keep `tools/list`
    // deterministic (stable ordering keeps client prompt caches warm), and
    // EXPECTED_TOOLS is written in registration order.
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS)

    const loadList = tools.find((t) => t.name === 'load_list')
    expect(loadList?.inputSchema.type).toBe('object')
    expect(loadList?.inputSchema.required).toContain('listType')
    expect(loadList?.inputSchema.required).toContain('slug')

    // Mutation tools hide the content hash entirely — the agent never supplies one.
    for (const name of MUTATION_TOOLS) {
      const tool = tools.find((t) => t.name === name)
      const props = Object.keys(tool?.inputSchema.properties ?? {})
      expect({ name, empty: props.length === 0, hasContentHash: props.includes('contentHash') }) //
        .toEqual({ name, empty: false, hasContentHash: false })
    }
  })

  test('advertises schemas that survive JSON Schema 2020-12 conversion', async () => {
    const { tools } = await client.listTools()
    const schemaOf = (name: string): Record<string, unknown> =>
      tools.find((t) => t.name === name)?.inputSchema as unknown as Record<string, unknown>

    const addCard = schemaOf('add_card')
    const props = addCard.properties as Record<string, Record<string, unknown>>
    // A `.toLowerCase()` transform must still advertise as a plain string, not
    // as a pipe/intersection an agent cannot fill in.
    expect(props.set).toMatchObject({ type: 'string' })
    // A defaulted field carries its default and stays out of `required`.
    expect(props.quantity).toMatchObject({ type: 'integer', default: 1 })
    expect(addCard.required).toEqual(['listType', 'slug', 'cardName'])
    // `.describe()` text must survive the conversion — it is the agent's only
    // documentation for a field.
    expect(props.cardName?.description).toContain('Card name')

    // A two-arg record advertises as an open object, not as an unusable shape
    // (`additionalProperties: false` would forbid every key).
    const config = (schemaOf('update_config').properties as Record<string, unknown>)
      .config as Record<string, unknown>
    expect(config.type).toBe('object')
    expect(config.additionalProperties).not.toBe(false)

    expect(Object.keys(schemaOf('sync_collection').properties as object).sort()).toEqual([
      'csv',
      'direction',
      'dryRun',
      'ignoreUnreadableLines',
      'into',
      'lists',
      'only',
      'removalPriority',
    ])
    expect(schemaOf('sync_collection').required).toEqual(['direction'])
    expect(Object.keys(schemaOf('sync_decks').properties as object)).toContain(
      'ignoreUnreadableLines',
    )
    expect(Object.keys(schemaOf('sync_decks').properties as object)).toContain('only')
  })

  test('flags every data-destroying tool with destructiveHint', async () => {
    const { tools } = await client.listTools()
    const destructiveHinted = new Set(
      tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name),
    )

    // Renames, deletes, history rewrites, config/site/cache/sync ops, plus the
    // import tools (deck/CSV can overwrite an existing list; changes can remove
    // cards) and apply_changes (a change batch can remove cards in bulk).
    expect(destructiveHinted).toEqual(
      new Set([
        'rename_list',
        'delete_list',
        'rewrite_history',
        'update_config',
        'build_site',
        'sync_decks',
        'sync_collection',
        'refresh_cache',
        'import_deck',
        'import_csv',
        'import_changes',
        'apply_changes',
      ]),
    )
    // The exact-set equality above also pins that purely additive edits
    // (add_card etc.) stay unflagged — no per-tool assertion needed.
  })

  test('list_lists returns every list and filters by listType', async () => {
    const all = toolJson(await callTool(client, 'list_lists', {})) as {
      lists: { listType: string; slug: string }[]
    }
    expect(all.lists.map((l) => `${l.listType}:${l.slug}`).sort()).toEqual([
      'collection:shoebox',
      'deck:test-deck',
      'wanted:wishlist',
    ])

    const decksOnly = toolJson(await callTool(client, 'list_lists', { listType: 'deck' })) as {
      lists: unknown[]
    }
    expect(decksOnly.lists).toEqual([{ listType: 'deck', slug: 'test-deck', name: 'Test Deck' }])
  })

  test('load_list returns deck contents without the heavy card payload', async () => {
    const result = await callTool(client, 'load_list', { listType: 'deck', slug: 'test-deck' })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as LoadedDeck
    expect(deckCardNames(data)).toContain('Sol Ring')
    expect(data.cards).toBeUndefined()
  })

  test('load_list returns flat-list entries', async () => {
    const added = await callTool(client, 'add_card', {
      listType: 'wanted',
      slug: 'wishlist',
      cardName: 'Brainstorm',
    })
    expect(added.isError).toBeFalsy()

    const data = toolJson(
      await callTool(client, 'load_list', { listType: 'wanted', slug: 'wishlist' }),
    ) as { entries: { name: string }[]; cards?: unknown }
    expect(data.entries.map((e) => e.name)).toContain('Brainstorm')
    expect(data.cards).toBeUndefined()
  })

  test('export_cards renders the selected list with chosen columns', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
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

  // Wiring only: the dialect's spellings are pinned by the renderer's unit
  // tests — this proves the tool's field reaches them.
  test('export_cards passes the value dialect through', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      format: 'csv',
      columns: ['name', 'finish', 'condition'],
      dialect: 'archidekt',
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { content: string }
    expect(data.content.split('\n')[0]).toBe('Name,Variant,Condition')
    expect(data.content.split('\n')[1]).toBe('Sol Ring,Normal,NM')
  })

  test('export_cards rejects an unknown dialect', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      dialect: 'moxfield',
    })
    expectSchemaRejection(result, /dialect/)
  })

  test('export_cards renders a plain-text export as one flat decklist', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      format: 'text',
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { format: string; content: string }
    expect(data.format).toBe('text')
    expect(data.content.split('\n')).toEqual(['1 Sol Ring', '1 Lightning Bolt'])
  })

  test('export_cards renders a markdown export with headings and no &N ids', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      format: 'md',
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { format: string; content: string }
    expect(data.format).toBe('md')
    expect(data.content).toContain('# test-deck')
    expect(data.content).toContain('## Commander')
    expect(data.content).toContain('1 Sol Ring')
    expect(data.content).not.toContain('&')
  })

  test('export_cards rejects an unknown list with a clear error', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ name: 'nope' }],
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('nope')
  })

  test('diff_lists compares two lists through the admin diff route', async () => {
    // Diff semantics are pinned by test/unit/list-diff.test.ts and the handler
    // test; this pins the tool wiring ([type:]name query building + body shape).
    await callTool(client, 'add_card', {
      listType: 'wanted',
      slug: 'wishlist',
      cardName: 'Sol Ring',
    })

    const result = await callTool(client, 'diff_lists', {
      a: { listType: 'deck', name: 'test-deck' },
      b: { name: 'wishlist' },
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      success: boolean
      a: { type: string; slug: string }
      b: { type: string; slug: string }
      by: string
      matches: { name: string }[]
      onlyInA: { name: string }[]
      onlyInB: unknown[]
    }
    expect(data.success).toBe(true)
    expect(data.a).toMatchObject({ type: 'deck', slug: 'test-deck' })
    expect(data.b).toMatchObject({ type: 'wanted', slug: 'wishlist' })
    expect(data.by).toBe('name')
    expect(data.matches.map((m) => m.name)).toEqual(['Sol Ring'])
    expect(data.onlyInA.map((o) => o.name)).toEqual(['Lightning Bolt'])
    expect(data.onlyInB).toEqual([])
  })

  test('diff_lists rejects a missing side and an unknown by mode', async () => {
    const missingSide = await callTool(client, 'diff_lists', {
      a: { listType: 'deck', name: 'test-deck' },
    })
    // Anchor "b" to the rejection wording so a message merely containing a
    // stray "b" cannot satisfy it.
    expectSchemaRejection(missingSide, /\bb\b.*(required|invalid|expected)/i)

    const badBy = await callTool(client, 'diff_lists', {
      a: { name: 'test-deck' },
      b: { name: 'wishlist' },
      by: 'set',
    })
    expectSchemaRejection(badBy, /\bby\b/)
  })

  test('add_card persists a new deck card (no content hash exposed)', async () => {
    const added = await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
    })
    expect(added.isError).toBeFalsy()

    expect(deckCardNames(await loadDeck('test-deck'))).toContain('Counterspell')

    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    // The card must be written with a freshly allocated &N id (1 and 2 are taken).
    expect(onDisk).toMatch(/Counterspell &\d+/)
  })

  test('add_card quantity adds all copies in one save with one changelog block', async () => {
    const added = await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
      quantity: 3,
    })
    expect(added.isError).toBeFalsy()

    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(onDisk).toMatch(/3 Counterspell &\d+/)

    // One save round trip → exactly one "## <timestamp>" changelog block.
    const changelog = await fs.readFile(
      path.join(env.dir, 'decks', 'test-deck.changes.md'),
      'utf-8',
    )
    expect(changelog.match(/^## /gm)).toHaveLength(1)
  })

  test('add_card persists a collection card through the disk-rederiving save path', async () => {
    const added = await callTool(client, 'add_card', {
      listType: 'collection',
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

  test('add_card rejects a condition on a wanted list', async () => {
    const result = await callTool(client, 'add_card', {
      listType: 'wanted',
      slug: 'wishlist',
      cardName: 'Brainstorm',
      condition: 'NM',
    })
    expectSchemaRejection(result, /condition/)
  })

  test('remove_card deletes the deck line at quantity zero', async () => {
    const removed = await callTool(client, 'remove_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Lightning Bolt',
    })
    expect(removed.isError).toBeFalsy()
    const names = deckCardNames(await loadDeck('test-deck'))
    expect(names).not.toContain('Lightning Bolt')
    expect(names).toContain('Sol Ring')
  })

  test('remove_card quantity removes that many deck copies in one save', async () => {
    await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
      quantity: 3,
    })
    const removed = await callTool(client, 'remove_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
      quantity: 2,
    })
    expect(removed.isError).toBeFalsy()
    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(onDisk).toMatch(/1 Counterspell &\d+/)
  })

  test('remove_card removes a flat-list entry by name', async () => {
    await callTool(client, 'add_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'Llanowar Elves',
      set: 'LEB',
      collectorNumber: '203',
    })
    const removed = await callTool(client, 'remove_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'Llanowar Elves',
    })
    expect(removed.isError).toBeFalsy()
    const onDisk = await fs.readFile(path.join(env.dir, 'collections', 'shoebox.md'), 'utf-8')
    expect(onDisk).not.toContain('Llanowar Elves')
  })

  test('remove_card rejects quantity above 1 on a flat list', async () => {
    const result = await callTool(client, 'remove_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'Llanowar Elves',
      quantity: 2,
    })
    expectSchemaRejection(result, /one entry per physical card/)
  })

  test('set_card_section moves a deck card into a (created) section', async () => {
    const moved = await callTool(client, 'set_card_section', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Lightning Bolt',
      section: 'Sideboard',
    })
    expect(moved.isError).toBeFalsy()
    const data = await loadDeck('test-deck')
    const sideboard = data.deck.sections.find((s) => s.name === 'Sideboard')
    expect(sideboard?.cards.map((c) => c.name)).toEqual(['Lightning Bolt'])
  })

  test('unset_commander moves the commander back to the main section', async () => {
    const result = await callTool(client, 'unset_commander', {
      slug: 'test-deck',
      cardName: 'Sol Ring',
    })
    expect(result.isError).toBeFalsy()
    const data = await loadDeck('test-deck')
    const commander = data.deck.sections.find((s) => s.name === 'Commander')
    expect(commander?.cards ?? []).toHaveLength(0)
    const main = data.deck.sections.find((s) => s.name === 'Main')
    expect(main?.cards.map((c) => c.name)).toContain('Sol Ring')
  })

  test('apply_changes applies an ordered batch in one save with one changelog block', async () => {
    const result = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [
        { action: 'add', cardName: 'Counterspell' },
        { action: 'remove', cardName: 'Lightning Bolt' },
      ],
    })
    expect(result.isError).toBeFalsy()

    const names = deckCardNames(await loadDeck('test-deck'))
    expect(names).toContain('Counterspell')
    expect(names).not.toContain('Lightning Bolt')

    const changelog = await fs.readFile(
      path.join(env.dir, 'decks', 'test-deck.changes.md'),
      'utf-8',
    )
    expect(changelog.match(/^## /gm)).toHaveLength(1)
  })

  test('apply_changes rejects unsupported change actions', async () => {
    for (const action of ['move-from', 'add-section']) {
      const result = await callTool(client, 'apply_changes', {
        listType: 'deck',
        slug: 'test-deck',
        changes: [{ action, cardName: 'Sol Ring', section: 'X' }],
      })
      expect({ action, isError: result.isError }).toEqual({ action, isError: true })
      // Name the discriminator, not the SDK's issue-path rendering
      // ("changes.0.action" vs "changes[0].action" is not contractual).
      expect(firstText(result)).toMatch(/action/)
    }
  })

  test('move_cards moves an identity-addressed card between lists', async () => {
    const result = await callTool(client, 'move_cards', {
      moves: [
        {
          listType: 'deck',
          slug: 'test-deck',
          cardName: 'Lightning Bolt',
          cardId: 2,
          toListType: 'wanted',
          toSlug: 'wishlist',
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { moved: number; requested: number; skipped: number }
    expect(data.moved).toBe(1)
    expect(data.requested).toBe(1)
    expect(data.skipped).toBe(0)

    expect(deckCardNames(await loadDeck('test-deck'))).not.toContain('Lightning Bolt')
    const wishlist = await fs.readFile(path.join(env.dir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(wishlist).toContain('Lightning Bolt')
  })

  test('move_cards skips an unresolvable item and still applies the rest', async () => {
    const result = await callTool(client, 'move_cards', {
      moves: [
        {
          listType: 'deck',
          slug: 'test-deck',
          cardName: 'Lightning Bolt',
          cardId: 2,
          toListType: 'wanted',
          toSlug: 'wishlist',
        },
        {
          listType: 'deck',
          slug: 'test-deck',
          cardName: 'Phantom Card',
          cardId: 99,
          toListType: 'wanted',
          toSlug: 'wishlist',
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { moved: number; requested: number; skipped: number }
    expect(data).toMatchObject({ moved: 1, requested: 2, skipped: 1 })
  })

  test('move_cards rejects toSection for a non-deck destination', async () => {
    const result = await callTool(client, 'move_cards', {
      moves: [
        {
          listType: 'deck',
          slug: 'test-deck',
          cardName: 'Lightning Bolt',
          toListType: 'wanted',
          toSlug: 'wishlist',
          toSection: 'Main',
        },
      ],
    })
    expectSchemaRejection(result, /toSection/)
  })

  test('remove_cards removes an identity-addressed batch', async () => {
    const result = await callTool(client, 'remove_cards', {
      removes: [{ listType: 'deck', slug: 'test-deck', cardName: 'Sol Ring', cardId: 1 }],
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { removed: number; skipped: number }
    expect(data.removed).toBe(1)
    expect(data.skipped).toBe(0)
    expect(deckCardNames(await loadDeck('test-deck'))).not.toContain('Sol Ring')
  })

  test('remove_cards skips an unresolvable item and still applies the rest', async () => {
    const result = await callTool(client, 'remove_cards', {
      removes: [
        { listType: 'deck', slug: 'test-deck', cardName: 'Sol Ring', cardId: 1 },
        { listType: 'deck', slug: 'test-deck', cardName: 'Phantom Card', cardId: 99 },
      ],
    })
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as { removed: number; requested: number; skipped: number }
    expect(data).toMatchObject({ removed: 1, requested: 2, skipped: 1 })
  })

  test('price_report summarizes every list and details one list', async () => {
    // Seed one priced printing so the cache is non-empty; the other synthetic
    // cards resolve to no printings via the offline stub and price as missing.
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring', prices: { usd: '2.50', eur: '4.00' } })],
    })

    const summary = toolJson(await callTool(client, 'price_report', {})) as {
      success: boolean
      currency: string
      lists: { type: string }[]
    }
    expect(summary.success).toBe(true)
    expect(summary.currency).toBe('usd')
    expect(summary.lists.length).toBeGreaterThan(0)

    // Shape-only wiring checks: the exact totals are pinned by the price-report
    // engine tests and the admin handler tests, not re-computed here.
    const detail = toolJson(
      await callTool(client, 'price_report', {
        listType: 'deck',
        slug: 'test-deck',
        currency: 'eur',
      }),
    ) as {
      success: boolean
      currency: string
      list?: { name: string; total: number }
      cards: unknown[]
    }
    expect(detail.success).toBe(true)
    expect(detail.currency).toBe('eur')
    expect(detail.list?.name).toBe('test-deck')
    expect(typeof detail.list?.total).toBe('number')
    expect(detail.cards.length).toBeGreaterThan(0)
  })

  test('price_report scopes the summary to one list type with listType alone', async () => {
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring', prices: { usd: '2.50', eur: '4.00' } })],
    })

    const summary = toolJson(await callTool(client, 'price_report', { listType: 'deck' })) as {
      success: boolean
      lists: { type: string }[]
    }
    expect(summary.success).toBe(true)
    expect(summary.lists.length).toBeGreaterThan(0)
    expect(summary.lists.every((l) => l.type === 'deck')).toBe(true)
  })

  test('price_report rejects a slug without a listType', async () => {
    const result = await callTool(client, 'price_report', { slug: 'test-deck' })
    expectSchemaRejection(result, /slug requires listType/)
  })

  test('load_history returns the change sets for a list', async () => {
    await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
    })
    const data = toolJson(
      await callTool(client, 'load_history', { listType: 'deck', slug: 'test-deck' }),
    ) as { success: boolean; sets: { lines: string[] }[] }
    expect(data.success).toBe(true)
    expect(data.sets).toHaveLength(1)
    expect(data.sets[0]?.lines.join('\n')).toContain('Counterspell')
  })

  test('deck_sync_status reports linked decks and the Archidekt login', async () => {
    // Which decks qualify is owned by test/integration/deck-sync-api.test.ts; the
    // fixture workspace has no Archidekt-linked deck and no stored login.
    const result = await callTool(client, 'deck_sync_status', {})
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      decks: unknown[]
      archidekt: { loginRequired: boolean }
    }
    expect(data.decks).toEqual([])
    expect(data.archidekt.loginRequired).toBe(true)
  })

  test('collection_sync_status reports the lists, the pull target, and the login', async () => {
    // Which lists qualify is owned by test/integration/collection-sync-api.test.ts;
    // this pins the wiring and the shape.
    const result = await callTool(client, 'collection_sync_status', {})
    expect(result.isError).toBeFalsy()
    const data = toolJson(result) as {
      lists: { slug: string }[]
      pullTarget: string
      csvThreshold: number
      lastSynced: string | null
      archidekt: { loginRequired: boolean }
    }
    expect(data.lists.map((list) => list.slug)).toEqual(['shoebox'])
    expect(data.pullTarget).toBe('Inbox')
    // The count above which a push must be told to upload its new cards, so a
    // caller can explain the `csv` field without hardcoding the engine's number.
    expect(data.csvThreshold).toBe(CSV_UPLOAD_THRESHOLD)
    expect(data.lastSynced).toBeNull()
    expect(data.archidekt.loginRequired).toBe(true)
  })

  test('sync_decks rejects an unknown direction and errors without a login', async () => {
    const badDirection = await callTool(client, 'sync_decks', { direction: 'sideways' })
    expectSchemaRejection(badDirection, /direction/)

    const noLogin = await callTool(client, 'sync_decks', { direction: 'pull' })
    expect(noLogin.isError).toBe(true)
    expect(firstText(noLogin)).toContain('Not signed into Archidekt')
  })

  test('sync_decks passes ignoreUnreadableLines and only through to the handler', async () => {
    // A renamed field on either side of callApi would be rejected by the
    // handler's validation rather than reaching the login check.
    const result = await callTool(client, 'sync_decks', {
      direction: 'pull',
      ignoreUnreadableLines: true,
      only: 'additions',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Not signed into Archidekt')

    const badFilter = await callTool(client, 'sync_decks', { direction: 'pull', only: 'adds' })
    expectSchemaRejection(badFilter, /\bonly\b/)

    const { tools } = await client.listTools()
    const schema = tools.find((tool) => tool.name === 'sync_decks')?.inputSchema
    expect(Object.keys(schema?.properties ?? {})).toContain('ignoreUnreadableLines')
    expect(Object.keys(schema?.properties ?? {})).toContain('only')
  })

  test('sync_collection rejects invalid input before it reaches the handler', async () => {
    // The schema is the gate: a missing/unknown direction, an unknown filter, and
    // a blank list or target never reach the admin handler at all.
    type RejectionCase = { args: Record<string, unknown>; offender: RegExp }
    const cases: RejectionCase[] = [
      { args: {}, offender: /direction/ },
      { args: { direction: 'sideways' }, offender: /direction/ },
      { args: { direction: 'pull', only: 'adds' }, offender: /only/ },
      { args: { direction: 'pull', lists: [''] }, offender: /lists/ },
      { args: { direction: 'pull', into: '' }, offender: /into/ },
      { args: { direction: 'pull', removalPriority: 'Long Box' }, offender: /removalPriority/ },
      { args: { direction: 'pull', removalPriority: [''] }, offender: /removalPriority/ },
      { args: { direction: 'push', csv: 'yes' }, offender: /csv/ },
    ]
    for (const { args, offender } of cases) {
      const result = await callTool(client, 'sync_collection', args)
      // Each row must be rejected *for its own reason*, not merely rejected.
      expect({ args, isError: result.isError }).toEqual({ args, isError: true })
      expect(firstText(result)).toMatch(offender)
    }
  })

  test('sync_collection reaches the handler’s login check with every field accepted', async () => {
    // A full, valid argument set clears the schema AND the admin handler's own
    // validation, reaching its login check — which is as far as a workspace with
    // no stored Archidekt session (and no network) can go. What the engine then
    // does is owned by test/unit/collection-sync/* and the CLI/API integration
    // tests. This cannot prove each field reached the request *body* (the handler
    // ignores keys it does not know): the body is typed as the endpoint's own
    // `CollectionSyncRequest`, so a renamed key is a compile error instead.
    const result = await callTool(client, 'sync_collection', {
      direction: 'pull',
      lists: ['shoebox'],
      only: 'additions',
      into: 'Inbox',
      removalPriority: ['Long Box', 'Blue Binder'],
      csv: true,
      dryRun: true,
      ignoreUnreadableLines: true,
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Not signed into Archidekt')

    const { tools } = await client.listTools()
    const schema = tools.find((tool) => tool.name === 'sync_collection')?.inputSchema
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'csv',
      'direction',
      'dryRun',
      'ignoreUnreadableLines',
      'into',
      'lists',
      'only',
      'removalPriority',
    ])
    expect(schema?.required).toEqual(['direction'])
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

  test('import_csv rejects format for a non-deck list', async () => {
    const result = await callTool(client, 'import_csv', {
      listType: 'collection',
      name: 'csv-cards',
      content: 'Name\nBrainstorm',
      columns: 'name=1',
      format: 'commander',
    })
    expectSchemaRejection(result, DECK_ONLY_FORMAT_MESSAGE)
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

  test('returns an isError result for a missing list', async () => {
    const result = await callTool(client, 'load_list', { listType: 'deck', slug: 'no-such-deck' })
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('not found')
  })

  test('rejects invalid arguments before reaching the handler', async () => {
    const result = await callTool(client, 'add_card', {})
    // Every required field must be named in the rejection.
    for (const field of ['listType', 'slug', 'cardName']) {
      expectSchemaRejection(result, new RegExp(`\\b${field}\\b`))
    }
  })

  test('create_list creates a list of each addressable type', async () => {
    const created = await callTool(client, 'create_list', {
      listType: 'collection',
      name: 'Trade Binder',
    })
    expect(created.isError).toBeFalsy()

    const lists = toolJson(await callTool(client, 'list_lists', { listType: 'collection' })) as {
      lists: { slug: string }[]
    }
    expect(lists.lists.map((l) => l.slug)).toContain('Trade Binder')
  })

  test('create_list rejects a format outside the canonical set', async () => {
    const result = await callTool(client, 'create_list', {
      listType: 'deck',
      name: 'Cube Deck',
      format: 'cube',
    })
    expectSchemaRejection(result, /format/)
  })

  test('create_list rejects a format on a non-deck list', async () => {
    const result = await callTool(client, 'create_list', {
      listType: 'wanted',
      name: 'Wants',
      format: 'commander',
    })
    expectSchemaRejection(result, DECK_ONLY_FORMAT_MESSAGE)
  })

  test('exposes lists as readable resources with the load_list projection', async () => {
    const { resources } = await client.listResources()
    const uris = resources.map((r) => r.uri)
    expect(uris).toContain('ritual://deck/test-deck')

    const read = await client.readResource({ uri: 'ritual://deck/test-deck' })
    const entry = read.contents[0]
    expect(entry?.uri).toBe('ritual://deck/test-deck')
    expect(entry?.mimeType).toBe('application/json')
    const text = entry && 'text' in entry ? entry.text : ''
    const parsed = JSON.parse(String(text)) as { deck: { name: string }; cards?: unknown }
    expect(parsed.deck.name).toBe('Test Deck')
    // Same projection as load_list: the heavy editor payload never leaks through.
    expect(parsed.cards).toBeUndefined()
  })

  test('rename_list renames a list on disk', async () => {
    const renamed = await callTool(client, 'rename_list', {
      listType: 'wanted',
      slug: 'wishlist',
      newName: 'Big Wants',
    })
    expect(renamed.isError).toBeFalsy()
    const lists = toolJson(await callTool(client, 'list_lists', { listType: 'wanted' })) as {
      lists: { slug: string }[]
    }
    expect(lists.lists.map((l) => l.slug)).toContain('Big Wants')
    expect(lists.lists.map((l) => l.slug)).not.toContain('wishlist')
  })

  test('delete_list enforces the confirmName guard', async () => {
    const wrong = await callTool(client, 'delete_list', {
      listType: 'deck',
      slug: 'test-deck',
      confirmName: 'Wrong Name',
    })
    expect(wrong.isError).toBe(true)

    const right = await callTool(client, 'delete_list', {
      listType: 'deck',
      slug: 'test-deck',
      confirmName: 'Test Deck',
    })
    expect(right.isError).toBeFalsy()

    const lists = toolJson(await callTool(client, 'list_lists', { listType: 'deck' })) as {
      lists: { slug: string }[]
    }
    expect(lists.lists.map((l) => l.slug)).not.toContain('test-deck')
  })

  test('rewrite_history replaces the change log via listType addressing', async () => {
    const rewritten = await callTool(client, 'rewrite_history', {
      listType: 'deck',
      slug: 'test-deck',
      sets: [{ timestamp: '2026-01-01T00:00:00.000Z', lines: ['- Added Sol Ring'] }],
    })
    expect(rewritten.isError).toBeFalsy()

    const data = toolJson(
      await callTool(client, 'load_history', { listType: 'deck', slug: 'test-deck' }),
    ) as { sets: { lines: string[] }[] }
    expect(data.sets).toHaveLength(1)
    expect(data.sets[0]?.lines).toEqual(['- Added Sol Ring'])
  })

  test('update_config and get_config round-trip through the admin config handler', async () => {
    // Per-key validation and merge semantics belong to the admin handler (see
    // test/integration/admin-config.test.ts); this pins only the MCP wiring —
    // the tool reaches the handler and the change is visible through get_config.
    const updated = await callTool(client, 'update_config', {
      config: { defaultCurrency: 'EUR' },
    })
    expect(updated.isError).toBeFalsy()

    const got = toolJson(await callTool(client, 'get_config', {})) as { config: ConfigView }
    expect(got.config.defaultCurrency).toBe('eur')

    const rejected = await callTool(client, 'update_config', { config: { bogusKey: true } })
    expect(rejected.isError).toBe(true)
  })
})

/**
 * The suite above runs on `InMemoryTransport`, which only links 2025-era
 * instances — it is the regression net for the clients that exist today. The
 * 2026-07-28 leg has no in-memory serving entry, so drive `createMcpHandler`
 * through its own fetch. Wiring only: that the modern era is reached at all,
 * and that what only the modern era carries (the cache hints) is on the wire.
 */
describe('Ritual MCP server (2026-07-28 era)', () => {
  let env: RitualTestEnv
  let handler: ReturnType<typeof createMcpHandler>
  let client: Client

  beforeEach(async () => {
    env = await setupRitualTestEnv()
    // Same options as production (src/mcp/run.ts), so this leg cannot drift
    // from the configuration `ritual mcp --transport http` actually serves.
    handler = createMcpHandler(() => buildMcpServer(), { legacy: 'stateless' })
    const transport = new StreamableHTTPClientTransport(new URL('http://ritual.test/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    })
    client = new Client(
      { name: 'ritual-test', version: '0.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    )
    await client.connect(transport)
  })

  afterEach(async () => {
    await client.close()
    await handler.close()
    await env.cleanup()
  })

  test('negotiates the modern era and lists a stable catalogue across fresh instances', async () => {
    expect(client.getProtocolEra()).toBe('modern')
    // Every request builds a fresh server instance, so cross-request order
    // stability is only provable on this leg — and it is what keeps client
    // prompt caches warm. EXPECTED_TOOLS is registration order.
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS)
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS)
  })

  test('round-trips a write across per-request server instances', async () => {
    const added = await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
    })
    expect(added.isError).toBeFalsy()

    // The read runs on a *different* per-request instance than the write — the
    // stateless leg only works because all state lives on disk.
    const data = toolJson(
      await callTool(client, 'load_list', { listType: 'deck', slug: 'test-deck' }),
    ) as LoadedDeck
    expect(data.deck.sections.flatMap((s) => s.cards.map((c) => c.name))).toContain('Counterspell')

    const read = await client.readResource({ uri: 'ritual://deck/test-deck' })
    expect(read.contents[0]?.uri).toBe('ritual://deck/test-deck')
  })

  test('surfaces a schema rejection through the modern envelope', async () => {
    const result = await callTool(client, 'add_card', {})
    expectSchemaRejection(result, /cardName/)
  })

  test('carries the configured cache hints on cacheable results', async () => {
    // `ttlMs`/`cacheScope` exist only on 2026-era responses, so this is the only
    // layer that can prove the server's `cacheHints` reach a client. Assert
    // against the exported constants so policy and test cannot drift apart.
    type HintedResult = { ttlMs?: number; cacheScope?: string }
    type CacheableMethod =
      | 'tools/list'
      | 'resources/templates/list'
      | 'resources/list'
      | 'resources/read'
    const hintOf = async (
      method: CacheableMethod,
      params: Record<string, unknown>,
    ): Promise<HintedResult> => (await client.request({ method, params })) as HintedResult

    // The catalog surfaces are fixed per binary and carry the long TTL.
    for (const method of ['tools/list', 'resources/templates/list'] as const) {
      const result = await hintOf(method, {})
      expect({ method, ttlMs: result.ttlMs, cacheScope: result.cacheScope }).toEqual({
        method,
        ttlMs: STATIC_CATALOG_CACHE.ttlMs,
        cacheScope: STATIC_CATALOG_CACHE.cacheScope,
      })
    }

    // List contents change on every edit, so enumerations and reads never cache.
    const list = await hintOf('resources/list', {})
    expect(list.ttlMs).toBe(NEVER_CACHE.ttlMs)
    const read = await hintOf('resources/read', { uri: 'ritual://deck/test-deck' })
    expect(read.ttlMs).toBe(NEVER_CACHE.ttlMs)
    expect(read.cacheScope).toBe(NEVER_CACHE.cacheScope)
  })
})
