import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callApi } from '../dispatch'
import { jsonResult } from '../result'
import { listTypeSchema, slugField } from '../schemas'
import type { ScryfallCard } from '../../types'
import type {
  CollectionLoadResult,
  DeckLoadResult,
  PrintingSummary,
  WantedLoadResult,
} from '../types'

/** The Scryfall fields the printing summary projects from (all optional on input). */
type RawScryfallCard = Partial<
  Pick<
    ScryfallCard,
    'id' | 'name' | 'set' | 'collector_number' | 'rarity' | 'released_at' | 'finishes' | 'prices'
  >
>

interface CardPriceResponse {
  representative: RawScryfallCard | null
  lowestPriceCard: RawScryfallCard | null
  lowestPriceCardEur: RawScryfallCard | null
  lowestPriceCardTix: RawScryfallCard | null
}

interface CardPrintingsResponse {
  printings: RawScryfallCard[]
}

/** Project a full Scryfall card to the compact fields agents need, dropping image URLs etc. */
function summarizePrinting(card: RawScryfallCard | null): PrintingSummary | null {
  if (!card) return null
  return {
    scryfallId: card.id,
    name: card.name ?? '',
    set: card.set,
    collectorNumber: card.collector_number,
    rarity: card.rarity,
    releasedAt: card.released_at,
    finishes: card.finishes,
    prices: card.prices,
  }
}

/**
 * Register the read-only tools: listing, loading (projected to drop the heavy
 * Scryfall card/printing/price payloads the editors need but agents do not),
 * card search/lookup, change history, the cross-list move candidates, and config.
 */
export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'list_decks',
    {
      title: 'List decks',
      description: 'List every deck as { slug, name }.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await callApi('GET', '/api/decks')),
  )

  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description: 'List every collection.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await callApi('GET', '/api/collections')),
  )

  server.registerTool(
    'list_wanted',
    {
      title: 'List wanted lists',
      description: 'List every wanted list.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await callApi('GET', '/api/wanted')),
  )

  server.registerTool(
    'list_all_lists',
    {
      title: 'List all lists',
      description: 'List every deck, collection, and wanted list as { type, slug, name }.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await callApi('GET', '/api/history')),
  )

  server.registerTool(
    'load_deck',
    {
      title: 'Load deck',
      description: 'Load a deck: its sections, cards, and front matter.',
      inputSchema: { slug: slugField },
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => {
      const data = (await callApi('GET', `/api/deck/${encodeURIComponent(slug)}`)) as DeckLoadResult
      return jsonResult({ slug, deck: data.deck, frontMatter: data.frontMatter })
    },
  )

  server.registerTool(
    'load_collection',
    {
      title: 'Load collection',
      description: 'Load a collection: its card entries and section order.',
      inputSchema: { slug: slugField },
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => {
      const data = (await callApi(
        'GET',
        `/api/collection/${encodeURIComponent(slug)}`,
      )) as CollectionLoadResult
      return jsonResult({ slug, entries: data.entries, sectionOrder: data.sectionOrder })
    },
  )

  server.registerTool(
    'load_wanted',
    {
      title: 'Load wanted list',
      description: 'Load a wanted list: its card entries and section order.',
      inputSchema: { slug: slugField },
      annotations: { readOnlyHint: true },
    },
    async ({ slug }) => {
      const data = (await callApi(
        'GET',
        `/api/wanted/${encodeURIComponent(slug)}`,
      )) as WantedLoadResult
      return jsonResult({ slug, entries: data.entries, sectionOrder: data.sectionOrder })
    },
  )

  server.registerTool(
    'search_cards',
    {
      title: 'Search cards',
      description: 'Search Scryfall for card names matching a query (up to 20 names).',
      inputSchema: { query: z.string().min(1).describe('Search text.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => jsonResult(await callApi('POST', '/api/search-cards', { query })),
  )

  server.registerTool(
    'autocomplete_card',
    {
      title: 'Autocomplete card name',
      description: 'Autocomplete card names by prefix/substring (up to 20).',
      inputSchema: { query: z.string().min(1).describe('Partial card name.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) =>
      jsonResult(await callApi('GET', `/api/autocomplete?q=${encodeURIComponent(query)}`)),
  )

  server.registerTool(
    'card_printings',
    {
      title: 'Card printings',
      description:
        'List the printings of a card (set, collector number, rarity, finishes, prices).',
      inputSchema: { name: z.string().min(1).describe('Exact card name.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      const data = (await callApi(
        'GET',
        `/api/card-printings?name=${encodeURIComponent(name)}`,
      )) as CardPrintingsResponse
      return jsonResult({ name, printings: data.printings.map(summarizePrinting) })
    },
  )

  server.registerTool(
    'card_price',
    {
      title: 'Card price',
      description: 'Get a card’s representative printing and cheapest printing per currency.',
      inputSchema: { name: z.string().min(1).describe('Exact card name.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      const data = (await callApi(
        'GET',
        `/api/card-price?name=${encodeURIComponent(name)}`,
      )) as CardPriceResponse
      return jsonResult({
        name,
        representative: summarizePrinting(data.representative),
        lowestUsd: summarizePrinting(data.lowestPriceCard),
        lowestEur: summarizePrinting(data.lowestPriceCardEur),
        lowestTix: summarizePrinting(data.lowestPriceCardTix),
      })
    },
  )

  server.registerTool(
    'load_history',
    {
      title: 'Load change history',
      description: 'Load a list’s change history (newest first) plus the default-rewrite lines.',
      inputSchema: { type: listTypeSchema, slug: slugField },
      annotations: { readOnlyHint: true },
    },
    async ({ type, slug }) =>
      jsonResult(await callApi('GET', `/api/history/${type}/${encodeURIComponent(slug)}`)),
  )

  server.registerTool(
    'move_candidates',
    {
      title: 'Move candidates',
      description:
        'List every movable card across all lists with an opaque key for use with move_cards.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await callApi('GET', '/api/move')),
  )

  server.registerTool(
    'get_config',
    {
      title: 'Get config',
      description: 'Get the current Ritual configuration.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await callApi('GET', '/api/config')),
  )

  server.registerTool(
    'get_audit_log',
    {
      title: 'Get audit log',
      description: 'Get recent admin activity (login attempts, etc.).',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe('Max entries (default 100).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const query = limit === undefined ? '' : `?limit=${limit}`
      return jsonResult(await callApi('GET', `/api/audit-log${query}`))
    },
  )
}
