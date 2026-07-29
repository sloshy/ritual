import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { cardCache } from '../../../src/cache'
import { CSV_UPLOAD_THRESHOLD } from '../../../src/collection-sync/csv'
import { NEVER_CACHE, STATIC_CATALOG_CACHE } from '../../../src/mcp/cache-hints'
import { DECK_ONLY_FORMAT_MESSAGE } from '../../../src/mcp/schemas'
import { buildMcpServer } from '../../../src/mcp/server'
import { MCP_TOOL_NAMES } from '../../../src/mcp/tools/names'
import {
  expectSchemaRejection,
  expectStructuredOnly,
  firstText,
  toolData,
  toolError,
} from '../../mcp-test-utils'
import { makeScryfallCard } from '../../test-utils'
import {
  setupMcpClient,
  setupRitualTestEnv,
  type McpTestSession,
  type RitualTestEnv,
} from './harness'

// In registration order (read → write → destructive, as server.ts registers
// them) — the catalogue test asserts ordered equality to pin `tools/list`
// determinism, so this list must track the registration sequence exactly.
const EXPECTED_TOOLS = [
  // read
  'list_lists',
  'get_sync_status',
  'get_list',
  'search_scryfall',
  'autocomplete_card',
  'find_cards',
  'get_card_details',
  'get_card_printings',
  'get_card_price',
  'get_price_report',
  'get_history',
  'get_config',
  'get_cache_status',
  'diff_lists',
  'export_cards',
  // write
  'create_list',
  'import_deck',
  'import_csv',
  'import_change_bundle',
  'set_list_metadata',
  'add_card',
  'remove_card',
  'set_card_printing',
  'apply_changes',
  'move_selected_cards',
  'remove_selected_cards',
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
  'set_card_printing',
  'apply_changes',
  'move_selected_cards',
  'remove_selected_cards',
  'set_list_metadata',
]

/** The parts of an emitted JSON Schema the conversion test reaches into. */
type JsonSchemaNode = {
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
  oneOf?: JsonSchemaNode[]
}

type ConfigView = {
  defaultCurrency?: string
}

type LoadedDeck = {
  deck: { sections: { name: string; cards: { name: string }[] }[] }
  cards?: unknown
  warnings: string[]
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return await client.callTool({ name, arguments: args })
}

describe('Ritual MCP server (in-memory transport)', () => {
  let session: McpTestSession
  let env: RitualTestEnv
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient()
    env = session.env
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  async function loadDeck(slug: string): Promise<LoadedDeck> {
    return toolData<LoadedDeck>(await callTool(client, 'get_list', { listType: 'deck', slug }))
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
    // Two independent pins on purpose: EXPECTED_TOOLS is the hand-written order
    // record above, and MCP_TOOL_NAMES is the const the skills guard reads — so
    // neither can drift from the live catalogue without a failure here.
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES])

    const loadList = tools.find((t) => t.name === 'get_list')
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
    // as a pipe/intersection an agent cannot fill in. The normalization is
    // invisible in the JSON either way, and `setField` emits identically under
    // `io: 'input'` and `io: 'output'` — only the prose says it lowercases.
    expect(props.set).toMatchObject({ type: 'string' })
    // A defaulted field carries its default and stays **out** of `required`
    // under `io: 'input'`. Under `io: 'output'` the same zod field would be IN
    // `required` (a defaulted field is always present after parsing) — which is
    // why `quantityField` must never be reused in an output schema, and why the
    // output schemas are hand-authored JSON rather than derived from these.
    expect(props.quantity).toMatchObject({ type: 'integer', default: 1 })
    expect(addCard.required).toEqual(['listType', 'slug', 'cardName'])
    expect(addCard.required as string[]).not.toContain('quantity')
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

    // apply_changes' discriminated union emits as a fully-written-out oneOf, so
    // every field on the shared base costs one copy per branch. id/timestamp are
    // server-stamped and must not appear in any of them.
    const branches = (schemaOf('apply_changes').properties as Record<string, JsonSchemaNode>)
      .changes?.items?.oneOf
    expect(branches?.length).toBeGreaterThan(1)
    for (const branch of branches ?? []) {
      expect(Object.keys(branch.properties ?? {})).not.toContain('id')
      expect(Object.keys(branch.properties ?? {})).not.toContain('timestamp')
    }

    // Every integer field carries a meaningful bound, so no schema advertises
    // JavaScript's MAX_SAFE_INTEGER as a maximum an agent should read. This is a
    // whole-catalogue substring check, so it now covers the hand-authored
    // **output** schemas too — which is why those carry no numeric bounds at all
    // (bounds guide a caller, and an output schema has none).
    expect(JSON.stringify(tools)).not.toContain('9007199254740991')
  })

  test('a successful result is structured-only, with no duplicate text block', async () => {
    // The SEP-2106 auto-append fires only for a non-object `structuredContent`,
    // and every Ritual output schema is object-rooted — so writing a text block
    // ourselves would put the same JSON on the wire twice.
    const result = await callTool(client, 'list_lists', {})
    expectStructuredOnly(result)
    expect(toolData<{ lists: unknown[] }>(result).lists.length).toBeGreaterThan(0)
  })

  test('a failure carries a structured payload whose message matches its text block', async () => {
    // End-to-end over the transport: the payload shape, and the agreement
    // between the one-line text a legacy client shows and the structured
    // `message` a modern one reads.
    const result = await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'no-such-deck',
      cardName: 'Sol Ring',
    })
    const payload = toolError(result)
    expect(payload.code).toBe('invalid-request')
    expect(payload.message).toContain('no-such-deck')
    expect(payload.conflict).toBeUndefined()
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
        'import_change_bundle',
        'apply_changes',
      ]),
    )
    // The exact-set equality above also pins that purely additive edits
    // (add_card etc.) stay unflagged — no per-tool assertion needed.
  })

  test('list_lists returns every list and filters by listType', async () => {
    const all = toolData<{
      lists: { listType: string; slug: string }[]
    }>(await callTool(client, 'list_lists', {}))
    expect(all.lists.map((l) => `${l.listType}:${l.slug}`).sort()).toEqual([
      'collection:shoebox',
      'deck:test-deck',
      'wanted:wishlist',
    ])

    const decksOnly = toolData<{
      lists: unknown[]
    }>(await callTool(client, 'list_lists', { listType: 'deck' }))
    expect(decksOnly.lists).toEqual([{ listType: 'deck', slug: 'test-deck', name: 'Test Deck' }])
  })

  test('get_list returns deck contents without the heavy card payload', async () => {
    const result = await callTool(client, 'get_list', { listType: 'deck', slug: 'test-deck' })
    expect(result.isError).toBeFalsy()
    const data = toolData<LoadedDeck>(result)
    expect(deckCardNames(data)).toContain('Sol Ring')
    expect(data.cards).toBeUndefined()
    // The projection copies the route's `warnings` through; empty is the honest
    // report for this fixture, and the field being present is the contract.
    expect(data.warnings).toEqual([])
  })

  test('get_list surfaces the parser warnings of a list holding an unreadable line', async () => {
    const deckPath = path.join(env.dir, 'decks', 'test-deck.md')
    await fs.writeFile(deckPath, (await fs.readFile(deckPath, 'utf-8')) + '\nnot a card line\n')

    const data = toolData<LoadedDeck>(
      await callTool(client, 'get_list', { listType: 'deck', slug: 'test-deck' }),
    )
    // The whole point of carrying warnings to the agent surface: a list that
    // loaded merely shorter than it is, said out loud.
    expect(data.warnings).toEqual(['Skipped malformed line: not a card line'])
  })

  test('get_list returns flat-list entries', async () => {
    const added = await callTool(client, 'add_card', {
      listType: 'wanted',
      slug: 'wishlist',
      cardName: 'Brainstorm',
    })
    expect(added.isError).toBeFalsy()

    const data = toolData<{ entries: { name: string }[]; cards?: unknown }>(
      await callTool(client, 'get_list', { listType: 'wanted', slug: 'wishlist' }),
    )
    expect(data.entries.map((e) => e.name)).toContain('Brainstorm')
    expect(data.cards).toBeUndefined()
  })

  test('search_scryfall warms the local cache and promotes a whole-name match', async () => {
    // The harness answers every non-symbology request with a 404; swap in a
    // search page for this call only.
    const previousFetch = globalThis.fetch
    const page = {
      object: 'list',
      has_more: false,
      data: [
        makeScryfallCard({ id: 'p1', name: 'Shocking Grasp', set: 'lea' }),
        makeScryfallCard({ id: 'p2', name: 'Shock', set: 'lea' }),
      ],
    }
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/cards/search')) return Promise.resolve(Response.json(page))
      return previousFetch(input)
    }) as typeof fetch

    try {
      const data = toolData<{ warmed: boolean; cards: { name: string }[] }>(
        await callTool(client, 'search_scryfall', { query: 'Shock', warm: true }),
      )
      expect(data.warmed).toBe(true)
      // The whole-name match leads, even though Scryfall answered it second.
      expect(data.cards.map((c) => c.name)).toEqual(['Shock', 'Shocking Grasp'])
      expect(await cardCache.get('Shocking Grasp')).not.toBeNull()
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  test('get_list view "summary" returns counts only', async () => {
    const data = toolData<{
      listType: string
      counts: { entryCount: number; sections: { name: string }[] }
    }>(
      await callTool(client, 'get_list', {
        listType: 'deck',
        slug: 'test-deck',
        view: 'summary',
      }),
    )
    expect(data.listType).toBe('deck')
    expect(data.counts.entryCount).toBe(2)
    expect(data.counts.sections.map((s) => s.name)).toEqual(['Commander', 'Main'])
  })

  test('get_list filters narrow the entries and report the pre-limit total', async () => {
    const data = toolData<LoadedDeck & { totalCount: number }>(
      await callTool(client, 'get_list', {
        listType: 'deck',
        slug: 'test-deck',
        section: 'Main',
      }),
    )
    expect(deckCardNames(data)).toEqual(['Lightning Bolt'])
    expect(data.totalCount).toBe(1)
  })

  test('nameContains, limit, and offset all travel from the tool to the route', async () => {
    // Only `section` used to be exercised, so a query-string key spelled wrong
    // in `buildListLoadQuery` would have gone unnoticed for the other three.
    const filtered = toolData<LoadedDeck & { totalCount: number }>(
      await callTool(client, 'get_list', {
        listType: 'deck',
        slug: 'test-deck',
        nameContains: 'sol',
      }),
    )
    expect(deckCardNames(filtered)).toEqual(['Sol Ring'])

    const firstPage = toolData<LoadedDeck & { totalCount: number }>(
      await callTool(client, 'get_list', { listType: 'deck', slug: 'test-deck', limit: 1 }),
    )
    const secondPage = toolData<LoadedDeck & { totalCount: number }>(
      await callTool(client, 'get_list', {
        listType: 'deck',
        slug: 'test-deck',
        limit: 1,
        offset: 1,
      }),
    )
    expect(deckCardNames(firstPage)).toHaveLength(1)
    expect(deckCardNames(secondPage)).toHaveLength(1)
    expect(deckCardNames(secondPage)).not.toEqual(deckCardNames(firstPage))
    // totalCount is the whole list either way — that is what makes it pageable.
    expect(firstPage.totalCount).toBe(2)
    expect(secondPage.totalCount).toBe(2)
  })

  test('find_cards reports where a card physically lives', async () => {
    const data = toolData<{
      cards: { listType: string; listSlug: string; name: string }[]
      lists?: unknown[]
      warnings: string[]
    }>(await callTool(client, 'find_cards', { name: 'sol ring' }))
    expect(data.cards.map((c) => `${c.listType}:${c.listSlug}:${c.name}`)).toEqual([
      'deck:test-deck:Sol Ring',
    ])
    expect(data.warnings).toEqual([])
    // The roster is opt-in, so a plain lookup does not pay for it.
    expect(data.lists).toBeUndefined()

    const withLists = toolData<{ lists?: { slug: string }[] }>(
      await callTool(client, 'find_cards', { name: 'sol ring', includeLists: true }),
    )
    expect(withLists.lists?.map((l) => l.slug).sort()).toEqual(['shoebox', 'test-deck', 'wishlist'])
  })

  test('get_card_details returns the cached card report', async () => {
    const data = toolData<{
      name: string
      printingCount: number
    }>(await callTool(client, 'get_card_details', { name: 'Sol Ring' }))
    expect(data.name).toBe('Sol Ring')
    expect(data.printingCount).toBeGreaterThan(0)
  })

  test('autocomplete_card suggests names from the seeded cache', async () => {
    const data = toolData<{ names: string[] }>(
      await callTool(client, 'autocomplete_card', { query: 'sol' }),
    )
    expect(data.names).toContain('Sol Ring')
  })

  test('get_card_price reports the representative and cheapest printings', async () => {
    const data = toolData<{
      name: string
      representative: { set: string } | null
      lowestUsd: { set: string } | null
      lowestEur: unknown
      lowestTix: unknown
    }>(await callTool(client, 'get_card_price', { name: 'Sol Ring' }))
    expect(data.name).toBe('Sol Ring')
    // The four slots are always present, so a client reads them without probing;
    // an uncached currency is null rather than missing.
    expect(Object.keys(data).sort()).toEqual([
      'lowestEur',
      'lowestTix',
      'lowestUsd',
      'name',
      'representative',
    ])
    expect(data.representative?.set).toBeDefined()
  })

  test('get_cache_status reports the cache the pricing tools depend on', async () => {
    const data = toolData<{
      empty: boolean
      cardCount: number
      priceStale: boolean
    }>(await callTool(client, 'get_cache_status', {}))
    expect(data.empty).toBe(false)
    expect(data.cardCount).toBeGreaterThan(0)
    // The harness seeds through `bulkSet`, which stamps the refresh time, so the
    // prices this cache carries are fresh by the 24h convention.
    expect(data.priceStale).toBe(false)
  })

  test('get_card_printings projects identity only unless prices are asked for', async () => {
    const lean = toolData<{
      name: string
      printings: Record<string, unknown>[]
    }>(await callTool(client, 'get_card_printings', { name: 'Sol Ring' }))
    expect(lean.name).toBe('Sol Ring')
    expect(lean.printings[0]).toHaveProperty('set')
    expect(lean.printings[0]).not.toHaveProperty('prices')

    const priced = toolData<{ printings: Record<string, unknown>[] }>(
      await callTool(client, 'get_card_printings', { name: 'Sol Ring', includePrices: true }),
    )
    expect(priced.printings[0]).toHaveProperty('prices')
  })

  test('import_deck writes a deck from pasted decklist text', async () => {
    const data = toolData<{ message: string; deckName: string }>(
      await callTool(client, 'import_deck', {
        mode: 'text',
        name: 'Imported Deck',
        content: '1 Sol Ring\n1 Lightning Bolt\n',
      }),
    )
    expect(data.deckName).toBe('Imported Deck')
    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'Imported Deck.md'), 'utf-8')
    expect(onDisk).toContain('Sol Ring')
  })

  test('set_card_printing pins a printing and reports the effect', async () => {
    const data = toolData<{
      applied: number
      effects: { action: string; cardId: number; printing?: { set?: string } }[]
    }>(
      await callTool(client, 'set_card_printing', {
        listType: 'deck',
        slug: 'test-deck',
        cardName: 'Lightning Bolt',
        set: 'LEA',
        collectorNumber: '161',
      }),
    )
    expect(data.applied).toBe(1)
    expect(data.effects).toHaveLength(1)
    // Set codes stay lowercase in a data payload, however the caller spelled them.
    expect(data.effects[0]).toMatchObject({
      action: 'updated',
      cardId: 2,
      printing: { set: 'lea', collectorNumber: '161' },
    })
  })

  test('set_list_metadata writes deck front matter and clears a field with null', async () => {
    const set = await callTool(client, 'set_list_metadata', {
      listType: 'deck',
      slug: 'test-deck',
      description: 'A synthetic test deck',
      tags: ['test'],
    })
    expect(set.isError).toBeFalsy()
    const written = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(written).toContain('A synthetic test deck')

    const cleared = await callTool(client, 'set_list_metadata', {
      listType: 'deck',
      slug: 'test-deck',
      description: null,
    })
    expect(cleared.isError).toBeFalsy()
    expect(await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')).not.toContain(
      'A synthetic test deck',
    )
  })

  test('export_cards write mode returns a file path instead of the content', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      write: true,
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{ mode: string; path: string; bytes: number }>(result)
    expect(data.mode).toBe('file')
    expect(data.path.startsWith('exports/')).toBe(true)
    expect(data.bytes).toBeGreaterThan(0)
    expect(await fs.exists(path.join(env.dir, data.path))).toBe(true)
  })

  test('export_cards renders the selected list with chosen columns', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      format: 'csv',
      columns: ['name', 'quantity', 'section'],
      quoteAll: true,
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{
      mode: string
      entryCount: number
      content: string
      warnings: string[]
    }>(result)
    // Without `write`, the response is the inline arm.
    expect(data.mode).toBe('content')
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
    const data = toolData<{ content: string }>(result)
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
    const data = toolData<{ format: string; content: string }>(result)
    expect(data.format).toBe('text')
    expect(data.content.split('\n')).toEqual(['1 Sol Ring', '1 Lightning Bolt'])
  })

  test('export_cards renders a markdown export with headings and no &N ids', async () => {
    const result = await callTool(client, 'export_cards', {
      lists: [{ listType: 'deck', name: 'test-deck' }],
      format: 'md',
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{ format: string; content: string }>(result)
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
    const data = toolData<{
      a: { listType: string; slug: string }
      b: { listType: string; slug: string }
      by: string
      matches: { name: string }[]
      onlyInA: { name: string }[]
      onlyInB: unknown[]
    }>(result)
    // One list-naming vocabulary across the tools: a diff side comes back with
    // the same `listType` + `slug` pair every tool takes as arguments.
    expect(data.a).toMatchObject({ listType: 'deck', slug: 'test-deck' })
    expect(data.b).toMatchObject({ listType: 'wanted', slug: 'wishlist' })
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
    // Every edit tool reports a structured result, not bare prose, so a caller
    // can tell what happened without parsing a sentence.
    const data = toolData<{
      applied: number
      listType: string
      slug: string
      effects: { action: string; cardId: number; name: string }[]
    }>(added)
    expect(data).toMatchObject({ applied: 1, listType: 'deck', slug: 'test-deck' })
    expect(data.effects).toHaveLength(1)
    expect(data.effects[0]).toMatchObject({ action: 'added', name: 'Counterspell' })

    expect(deckCardNames(await loadDeck('test-deck'))).toContain('Counterspell')

    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    // The reported id must be the id actually written: that agreement is the
    // whole reason `effects` exists, and a `/Counterspell &\d+/` match would
    // hold just as well if the response invented a different number.
    expect(onDisk).toContain(`Counterspell &${data.effects[0]?.cardId}`)
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

  // Notes, sections, and the commander used to have tools of their own; they are
  // apply_changes actions now, so their coverage lives here rather than being lost.
  test('apply_changes set-section moves a deck card into a (created) section', async () => {
    const moved = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [{ action: 'set-section', cardName: 'Lightning Bolt', section: 'Sideboard' }],
    })
    expect(moved.isError).toBeFalsy()
    const data = await loadDeck('test-deck')
    const sideboard = data.deck.sections.find((s) => s.name === 'Sideboard')
    expect(sideboard?.cards.map((c) => c.name)).toEqual(['Lightning Bolt'])
  })

  test('apply_changes unset-commander moves the commander back to the main section', async () => {
    const result = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [{ action: 'unset-commander', cardName: 'Sol Ring' }],
    })
    expect(result.isError).toBeFalsy()
    const data = await loadDeck('test-deck')
    const commander = data.deck.sections.find((s) => s.name === 'Commander')
    expect(commander?.cards ?? []).toHaveLength(0)
    const main = data.deck.sections.find((s) => s.name === 'Main')
    expect(main?.cards.map((c) => c.name)).toContain('Sol Ring')
  })

  test('apply_changes set-note sets a note, and an empty string clears it', async () => {
    const set = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [{ action: 'set-note', cardName: 'Lightning Bolt', note: 'signed' }],
    })
    expect(set.isError).toBeFalsy()
    expect(await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')).toContain(
      'signed',
    )

    const cleared = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [{ action: 'set-note', cardName: 'Lightning Bolt', note: '' }],
    })
    expect(cleared.isError).toBeFalsy()
    expect(await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')).not.toContain(
      'signed',
    )
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

  test('move_selected_cards moves an identity-addressed card between lists', async () => {
    const result = await callTool(client, 'move_selected_cards', {
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
    const data = toolData<{ moved: number; requested: number; skipped: number }>(result)
    expect(data.moved).toBe(1)
    expect(data.requested).toBe(1)
    expect(data.skipped).toBe(0)

    expect(deckCardNames(await loadDeck('test-deck'))).not.toContain('Lightning Bolt')
    const wishlist = await fs.readFile(path.join(env.dir, 'wanted', 'wishlist.md'), 'utf-8')
    expect(wishlist).toContain('Lightning Bolt')
  })

  test('move_selected_cards skips an unresolvable item and still applies the rest', async () => {
    // The second item names a real card that simply is not in this deck under
    // that id — an unresolvable *entry*, which is skipped. (A name no cache
    // knows is a different failure: it is refused outright, see below.)
    const result = await callTool(client, 'move_selected_cards', {
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
          cardName: 'Counterspell',
          cardId: 99,
          toListType: 'wanted',
          toSlug: 'wishlist',
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{ moved: number; requested: number; skipped: number }>(result)
    expect(data).toMatchObject({ moved: 1, requested: 2, skipped: 1 })
  })

  test('move_selected_cards reports a note the destination could not keep', async () => {
    // `droppedNotes` is the one field of this result no other test reaches: it
    // fills only when a deck quantity-merge lands a noted card on an existing
    // line whose single note slot already says something else. Seed exactly that.
    await fs.writeFile(
      path.join(env.dir, 'collections', 'shoebox.md'),
      '# Shoebox\n\n- Lightning Bolt (LEA:161) {signed by the artist} &1\n',
    )
    // The merge is by name + printing, so pin the deck line to the same one.
    await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [
        {
          action: 'set-printing',
          cardName: 'Lightning Bolt',
          set: 'lea',
          collectorNumber: '161',
        },
        { action: 'set-note', cardName: 'Lightning Bolt', note: 'the deck copy' },
      ],
    })

    const result = await callTool(client, 'move_selected_cards', {
      moves: [
        {
          listType: 'collection',
          slug: 'shoebox',
          cardName: 'Lightning Bolt',
          cardId: 1,
          toListType: 'deck',
          toSlug: 'test-deck',
        },
      ],
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{
      moved: number
      droppedNotes: { cardName: string; cardId?: number; note: string }[]
    }>(result)
    expect(data.moved).toBe(1)
    expect(data.droppedNotes).toEqual([
      { cardName: 'Lightning Bolt', cardId: 1, note: 'signed by the artist' },
    ])
    // The deck line's own note is what survives the merge.
    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(onDisk).toContain('the deck copy')
    expect(onDisk).not.toContain('signed by the artist')
  })

  test('move_selected_cards rejects toSection for a non-deck destination', async () => {
    const result = await callTool(client, 'move_selected_cards', {
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

  test('remove_selected_cards removes an identity-addressed batch', async () => {
    const result = await callTool(client, 'remove_selected_cards', {
      removes: [{ listType: 'deck', slug: 'test-deck', cardName: 'Sol Ring', cardId: 1 }],
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{ removed: number; skipped: number }>(result)
    expect(data.removed).toBe(1)
    expect(data.skipped).toBe(0)
    expect(deckCardNames(await loadDeck('test-deck'))).not.toContain('Sol Ring')
  })

  test('remove_selected_cards skips an unresolvable item and still applies the rest', async () => {
    const result = await callTool(client, 'remove_selected_cards', {
      removes: [
        { listType: 'deck', slug: 'test-deck', cardName: 'Sol Ring', cardId: 1 },
        { listType: 'deck', slug: 'test-deck', cardName: 'Counterspell', cardId: 99 },
      ],
    })
    expect(result.isError).toBeFalsy()
    const data = toolData<{ removed: number; requested: number; skipped: number }>(result)
    expect(data).toMatchObject({ removed: 1, requested: 2, skipped: 1 })
  })

  test('get_price_report summarizes every list and details one list', async () => {
    // Seed one priced printing so the cache is non-empty; the other synthetic
    // cards resolve to no printings via the offline stub and price as missing.
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring', prices: { usd: '2.50', eur: '4.00' } })],
    })

    const summary = toolData<{
      mode: string
      currency: string
      lists: { type: string }[]
    }>(await callTool(client, 'get_price_report', {}))
    // `mode` is what discriminates the two price bodies for a client.
    expect(summary.mode).toBe('summary')
    expect(summary.currency).toBe('usd')
    expect(summary.lists.length).toBeGreaterThan(0)

    // Shape-only wiring checks: the exact totals are pinned by the price-report
    // engine tests and the admin handler tests, not re-computed here.
    const detail = toolData<{
      mode: string
      currency: string
      list?: { name: string; total: number }
      cards: unknown[]
    }>(
      await callTool(client, 'get_price_report', {
        listType: 'deck',
        slug: 'test-deck',
        currency: 'eur',
      }),
    )
    expect(detail.mode).toBe('list')
    expect(detail.currency).toBe('eur')
    expect(detail.list?.name).toBe('test-deck')
    expect(typeof detail.list?.total).toBe('number')
    expect(detail.cards.length).toBeGreaterThan(0)
  })

  test('get_price_report scopes the summary to one list type with listType alone', async () => {
    await cardCache.bulkSet({
      'Sol Ring': [makeScryfallCard({ name: 'Sol Ring', prices: { usd: '2.50', eur: '4.00' } })],
    })

    const summary = toolData<{
      lists: { type: string }[]
    }>(await callTool(client, 'get_price_report', { listType: 'deck' }))
    expect(summary.lists.length).toBeGreaterThan(0)
    expect(summary.lists.every((l) => l.type === 'deck')).toBe(true)
  })

  test('get_price_report rejects a slug without a listType', async () => {
    const result = await callTool(client, 'get_price_report', { slug: 'test-deck' })
    expectSchemaRejection(result, /slug requires listType/)
  })

  test('get_history returns the change sets for a list', async () => {
    await callTool(client, 'add_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'Counterspell',
    })
    const data = toolData<{ sets: { lines: string[] }[] }>(
      await callTool(client, 'get_history', { listType: 'deck', slug: 'test-deck' }),
    )
    expect(data.sets).toHaveLength(1)
    expect(data.sets[0]?.lines.join('\n')).toContain('Counterspell')
  })

  test('get_sync_status reports both halves when target is omitted', async () => {
    // Which decks/lists qualify is owned by the deck-sync and collection-sync
    // integration suites; this pins the wiring and the two-key shape. The fixture
    // workspace has no Archidekt-linked deck and no stored login.
    const result = await callTool(client, 'get_sync_status', {})
    expect(result.isError).toBeFalsy()
    const data = toolData<{
      decks: { decks: unknown[]; archidekt: { loginRequired: boolean } }
      collection: {
        lists: { slug: string }[]
        pullTarget: string
        csvThreshold: number
        lastSynced: string | null
        archidekt: { loginRequired: boolean }
      }
    }>(result)
    expect(data.decks.decks).toEqual([])
    expect(data.decks.archidekt.loginRequired).toBe(true)
    expect(data.collection.lists.map((list) => list.slug)).toEqual(['shoebox'])
    expect(data.collection.pullTarget).toBe('Inbox')
    // The count above which a push must be told to upload its new cards, so a
    // caller can explain the `csv` field without hardcoding the engine's number.
    expect(data.collection.csvThreshold).toBe(CSV_UPLOAD_THRESHOLD)
    expect(data.collection.lastSynced).toBeNull()
    expect(data.collection.archidekt.loginRequired).toBe(true)
  })

  test('get_sync_status returns only the half target names', async () => {
    const decksOnly = toolData<Record<string, unknown>>(
      await callTool(client, 'get_sync_status', { target: 'decks' }),
    )
    expect(Object.keys(decksOnly)).toEqual(['decks'])

    const collectionOnly = toolData<Record<string, unknown>>(
      await callTool(client, 'get_sync_status', { target: 'collection' }),
    )
    expect(Object.keys(collectionOnly)).toEqual(['collection'])
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
    const data = toolData<{ cardCount: number }>(result)
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

  test('import_change_bundle applies a change bundle to the target lists', async () => {
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
    const result = await callTool(client, 'import_change_bundle', { json: JSON.stringify(bundle) })
    expect(result.isError).toBeFalsy()
    const data = toolData<{
      lists: { slug: string; applied: number }[]
    }>(result)
    expect(data.lists.map((l) => l.applied)).toEqual([1, 1])

    const deckOnDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(deckOnDisk).toMatch(/Counterspell &\d+/)
  })

  test('import_change_bundle reports a partly-failed bundle instead of erroring', async () => {
    // The per-list report is the whole point of this tool, and a partial failure
    // is exactly when it matters — so a list that could not be resolved must
    // come back inside a *successful* result rather than collapsing the call
    // into an isError whose payload carries none of it.
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
          slug: 'no-such-list',
          name: 'No Such List',
          changes: [{ id: 'a2', timestamp: 2, action: 'add', cardName: 'Brainstorm' }],
        },
      ],
    }
    const result = await callTool(client, 'import_change_bundle', { json: JSON.stringify(bundle) })
    expect(result.isError).toBeFalsy()
    const data = toolData<{
      failedCount: number
      lists: { slug: string; applied: number; error?: string }[]
    }>(result)
    expect(data.failedCount).toBe(1)
    expect(data.lists.map((l) => l.applied)).toEqual([1, 0])
    expect(data.lists[0]?.error).toBeUndefined()
    expect(data.lists[1]?.error).toBeTruthy()
  })

  test('import_change_bundle rejects malformed JSON with a clear error', async () => {
    // Pins the tool's local pre-validation branch (bundle parse failures are
    // covered in test/unit/change-bundle.test.ts; the isError mapping is not).
    const result = await callTool(client, 'import_change_bundle', { json: '{"format":"other"}' })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Invalid change bundle')
  })

  test('returns an isError result for a missing list', async () => {
    const result = await callTool(client, 'get_list', { listType: 'deck', slug: 'no-such-deck' })
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

  test('remove_card that matches nothing errors and saves nothing', async () => {
    const deckPath = path.join(env.dir, 'decks', 'test-deck.md')
    const before = await fs.readFile(deckPath, 'utf-8')

    // Wrong case — matching is exact and case-sensitive.
    const result = await callTool(client, 'remove_card', {
      listType: 'deck',
      slug: 'test-deck',
      cardName: 'sol ring',
    })
    expect(result.isError).toBe(true)
    // The error names the change, says nothing was saved, and points at the recovery step.
    const message = firstText(result)
    expect(message).toContain('sol ring')
    expect(message).toContain('Nothing was saved')
    expect(message).toContain('get_list')

    // Neither the deck file nor a changelog was written.
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
    expect(await fs.exists(path.join(env.dir, 'decks', 'test-deck.changes.md'))).toBe(false)
  })

  test('remove_card that matches nothing in a collection errors via the save handler', async () => {
    // Seed an entry first so a miss is distinguishable from an empty list, then
    // prove the miss leaves the seeded state untouched.
    const seeded = await callTool(client, 'add_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'Sol Ring',
      set: 'c21',
      collectorNumber: '125',
    })
    expect(seeded.isError).toBeFalsy()
    const collPath = path.join(env.dir, 'collections', 'shoebox.md')
    const before = await fs.readFile(collPath, 'utf-8')

    // A real card that is simply not in this list: name validation passes, and
    // collections replay changes server-side, so the miss is rejected by the
    // collection-save handler (400) rather than the MCP-side apply.
    const result = await callTool(client, 'remove_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'Counterspell',
    })
    expect(result.isError).toBe(true)
    const message = firstText(result)
    expect(message).toContain('Counterspell')
    expect(message).toContain('Nothing was saved')

    expect(await fs.readFile(collPath, 'utf-8')).toBe(before)
  })

  test('a wrong-case card name is refused up front, with the cached spelling offered', async () => {
    // Targeting is exact and case-sensitive, so "sol ring" would have missed
    // anyway; catching it against the card cache first is what turns an
    // unhelpful "nothing matched" into a name the agent can act on.
    const result = await callTool(client, 'remove_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'sol ring',
    })
    expect(result.isError).toBe(true)
    const message = firstText(result)
    expect(message).toContain('sol ring')
    expect(message).toContain('Sol Ring')
  })

  test('a card already in the list stays editable even though no cache knows it', async () => {
    // The list file is the authority on what is in it, which is what keeps a
    // custom or unreleased card removable.
    await fs.writeFile(
      path.join(env.dir, 'collections', 'shoebox.md'),
      '# Shoebox\n\n- Homemade Proxy Beast (XXX:1) &1\n',
    )
    const result = await callTool(client, 'remove_card', {
      listType: 'collection',
      slug: 'shoebox',
      cardName: 'Homemade Proxy Beast',
    })
    expect(result.isError).toBeFalsy()
    expect(
      await fs.readFile(path.join(env.dir, 'collections', 'shoebox.md'), 'utf-8'),
    ).not.toContain('Homemade Proxy Beast')
  })

  test('remove_card that matches nothing in a wanted list errors and saves nothing', async () => {
    // A real card that is simply not on this list, so the refusal comes from the
    // MCP-side apply rather than from name validation.
    const result = await callTool(client, 'remove_card', {
      listType: 'wanted',
      slug: 'wishlist',
      cardName: 'Brainstorm',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('Brainstorm')
    expect(await fs.exists(path.join(env.dir, 'wanted', 'wishlist.changes.md'))).toBe(false)
  })

  test('commander actions on a flat list error with the applicability reason', async () => {
    const result = await callTool(client, 'apply_changes', {
      listType: 'wanted',
      slug: 'wishlist',
      changes: [{ action: 'set-commander', cardName: 'Sol Ring' }],
    })
    expect(result.isError).toBe(true)
    // The reason must not read as a name mismatch — the action can never apply.
    expect(firstText(result)).toContain('never apply to a wanted list')
  })

  test('apply_changes can target a card added earlier in the same batch', async () => {
    // Miss detection is interleaved with application — validating against the
    // initial state would wrongly reject this batch.
    const result = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [
        { action: 'add', cardName: 'Counterspell' },
        { action: 'set-note', cardName: 'Counterspell', note: 'added and annotated together' },
      ],
    })
    expect(result.isError).toBeFalsy()

    const loaded = await loadDeck('test-deck')
    expect(deckCardNames(loaded)).toContain('Counterspell')
    // The interleaved set-note must have *applied*, not merely not-missed.
    const onDisk = await fs.readFile(path.join(env.dir, 'decks', 'test-deck.md'), 'utf-8')
    expect(onDisk).toContain('added and annotated together')
  })

  test('apply_changes fails the whole batch when one change misses', async () => {
    const deckPath = path.join(env.dir, 'decks', 'test-deck.md')
    const before = await fs.readFile(deckPath, 'utf-8')

    const result = await callTool(client, 'apply_changes', {
      listType: 'deck',
      slug: 'test-deck',
      changes: [
        { action: 'add', cardName: 'Counterspell' },
        { action: 'remove', cardName: 'lightning bolt' }, // wrong case — misses
      ],
    })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('lightning bolt')

    // Atomic: the valid add must not have been persisted either.
    expect(await fs.readFile(deckPath, 'utf-8')).toBe(before)
  })

  test('create_list creates a collection the list roster then reports', async () => {
    const created = await callTool(client, 'create_list', {
      listType: 'collection',
      name: 'Trade Binder',
    })
    expect(created.isError).toBeFalsy()

    const lists = toolData<{
      lists: { slug: string }[]
    }>(await callTool(client, 'list_lists', { listType: 'collection' }))
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

  test('exposes lists as readable resources with the get_list projection', async () => {
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
    // Same projection as get_list: the heavy editor payload never leaks through.
    expect(parsed.cards).toBeUndefined()
  })

  test('rename_list renames a list on disk', async () => {
    const renamed = await callTool(client, 'rename_list', {
      listType: 'wanted',
      slug: 'wishlist',
      newName: 'Big Wants',
    })
    expect(renamed.isError).toBeFalsy()
    const lists = toolData<{
      lists: { slug: string }[]
    }>(await callTool(client, 'list_lists', { listType: 'wanted' }))
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

    const lists = toolData<{
      lists: { slug: string }[]
    }>(await callTool(client, 'list_lists', { listType: 'deck' }))
    expect(lists.lists.map((l) => l.slug)).not.toContain('test-deck')
  })

  test('rewrite_history replaces the change log via listType addressing', async () => {
    const rewritten = await callTool(client, 'rewrite_history', {
      listType: 'deck',
      slug: 'test-deck',
      sets: [{ timestamp: '2026-01-01T00:00:00.000Z', lines: ['- Added Sol Ring'] }],
    })
    expect(rewritten.isError).toBeFalsy()

    const data = toolData<{ sets: { lines: string[] }[] }>(
      await callTool(client, 'get_history', { listType: 'deck', slug: 'test-deck' }),
    )
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

    const got = toolData<{ config: ConfigView }>(await callTool(client, 'get_config', {}))
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
    const data = toolData<LoadedDeck>(
      await callTool(client, 'get_list', { listType: 'deck', slug: 'test-deck' }),
    )
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
