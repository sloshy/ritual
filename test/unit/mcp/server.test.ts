import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { cardCache } from '../../../src/cache'
import { buildMcpServer } from '../../../src/mcp/server'
import { makeScryfallCard } from '../../test-utils'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

const EXPECTED_TOOLS = [
  // read
  'list_lists',
  'load_list',
  'search_cards',
  'autocomplete_card',
  'card_printings',
  'card_price',
  'price_report',
  'load_history',
  'get_config',
  'get_audit_log',
  'export_cards',
  'diff_lists',
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
  site?: { bannedPrintings?: string[] }
  defaultCurrency?: string
  cacheLockTimeoutSeconds?: number
  cacheSource?: string
  cacheFeedUrl?: string
  admin?: { gitEnabled?: boolean; rateLimitEnabled?: boolean; rateLimitMaxAttempts?: number }
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

type LoadedDeck = {
  deck: { sections: { name: string; cards: { name: string }[] }[] }
  cards?: unknown
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

  async function loadDeck(slug: string): Promise<LoadedDeck> {
    return toolJson(await callTool(client, 'load_list', { listType: 'deck', slug })) as LoadedDeck
  }

  function deckCardNames(data: LoadedDeck): string[] {
    return data.deck.sections.flatMap((s) => s.cards.map((c) => c.name))
  }

  test('negotiates capabilities and server identity on initialize', () => {
    expect(client.getServerVersion()?.name).toBe('ritual')
    const caps = client.getServerCapabilities()
    expect(caps?.tools).toBeDefined()
    expect(caps?.resources).toBeDefined()
  })

  test('lists the full tool catalogue with valid input schemas', async () => {
    const { tools } = await client.listTools()
    expect(new Set(tools.map((t) => t.name))).toEqual(new Set(EXPECTED_TOOLS))

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

  test('flags every data-destroying tool with destructiveHint', async () => {
    const { tools } = await client.listTools()
    const destructiveHinted = new Set(
      tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name),
    )

    // Renames, deletes, history rewrites, config/site/cache ops, plus the import
    // tools (deck/CSV can overwrite an existing list; changes can remove cards)
    // and apply_changes (a change batch can remove cards in bulk).
    expect(destructiveHinted).toEqual(
      new Set([
        'rename_list',
        'delete_list',
        'rewrite_history',
        'update_config',
        'build_site',
        'refresh_cache',
        'import_deck',
        'import_csv',
        'import_changes',
        'apply_changes',
      ]),
    )

    // Purely additive edits stay unflagged.
    const addCard = tools.find((t) => t.name === 'add_card')
    expect(addCard?.annotations?.destructiveHint).not.toBe(true)
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
    expect(missingSide.isError).toBe(true)
    expect(firstText(missingSide).toLowerCase()).toContain('validation')

    const badBy = await callTool(client, 'diff_lists', {
      a: { name: 'test-deck' },
      b: { name: 'wishlist' },
      by: 'set',
    })
    expect(badBy.isError).toBe(true)
    expect(firstText(badBy).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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
      expect(firstText(result).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
  })

  test('create_list rejects a format on a non-deck list', async () => {
    const result = await callTool(client, 'create_list', {
      listType: 'wanted',
      name: 'Wants',
      format: 'commander',
    })
    expect(result.isError).toBe(true)
    expect(firstText(result).toLowerCase()).toContain('validation')
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

  test('update_config accepts valid values and get_config returns them normalized', async () => {
    // Per-key validation semantics are owned by the ritual-config/`config set` unit
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
      { label: 'unknown top-level key', update: { bogusKey: true } },
      // Unknown nested admin keys must be rejected, not spread verbatim into
      // the persisted config (parseAdminConfig silently ignores them).
      { label: 'unknown nested admin key', update: { admin: { gitEnabled: true, bogusKey: 1 } } },
      { label: 'wrong-typed admin field', update: { admin: { gitEnabled: 'yes' } } },
      { label: 'wrong-typed directory key', update: { decksDir: 42 } },
    ]

    for (const { label, update } of cases) {
      const result = await callTool(client, 'update_config', { config: update })
      expect({ label, isError: result.isError }).toEqual({ label, isError: true })
    }
  })

  test('update_config deep-merges admin fields without clobbering siblings', async () => {
    const updated = await callTool(client, 'update_config', {
      config: { admin: { gitEnabled: true } },
    })
    expect(updated.isError).toBeFalsy()

    const got = toolJson(await callTool(client, 'get_config', {})) as { config: ConfigView }
    expect(got.config.admin?.gitEnabled).toBe(true)
    // Omitted admin siblings keep their current values, not their defaults.
    expect(got.config.admin?.rateLimitEnabled).toBe(true)
    expect(got.config.admin?.rateLimitMaxAttempts).toBe(5)
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
