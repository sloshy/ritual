import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callApi } from '../dispatch'
import { loadProjectedList } from '../projection'
import { jsonResult } from '../result'
import { currencySchema, finishSchema, listTypeSchema, slugField } from '../schemas'
import { EXPORT_PROPERTIES } from '../../export/render'
import { VALID_CONDITIONS } from '../../finish-condition'
import { DIFF_BY_MODES } from '../../list-diff'
import type { ListType } from '../../list-type'
import type { ScryfallCard } from '../../types'
import type { ListsResponse, PrintingSummary } from '../types'

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

/** One list as `list_lists` returns it (the tool vocabulary uses `listType`, not `type`). */
interface ListSummaryResult {
  listType: ListType
  slug: string
  name: string
}

/** `list_lists` result: every (optionally type-filtered) list as a summary. */
interface ListListsResult {
  lists: ListSummaryResult[]
}

/** One side of `diff_lists`: a list name resolved like CLI list arguments. */
const diffSideSchema = z.object({
  listType: listTypeSchema.optional().describe('Pin the list type of an ambiguous name.'),
  name: z
    .string()
    .min(1)
    .describe('List name (matched like CLI list arguments; a slug/file basename also works).'),
})

type DiffSideInput = z.infer<typeof diffSideSchema>

/** The `[type:]name` query value the admin diff route expects for one side. */
function diffSideParam(side: DiffSideInput): string {
  return side.listType === undefined ? side.name : `${side.listType}:${side.name}`
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
 * card search/lookup, price reports, change history, config, and exports.
 */
export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'list_lists',
    {
      title: 'List lists',
      description:
        'List every deck, collection, and wanted list as { listType, slug, name }, ' +
        'optionally filtered to one list type.',
      inputSchema: {
        listType: listTypeSchema.optional().describe('Only return lists of this type.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ listType }) => {
      const data = (await callApi('GET', '/api/lists')) as ListsResponse
      const lists = listType ? data.lists.filter((l) => l.type === listType) : data.lists
      const result: ListListsResult = {
        lists: lists.map((l) => ({ listType: l.type, slug: l.slug, name: l.name })),
      }
      return jsonResult(result)
    },
  )

  server.registerTool(
    'load_list',
    {
      title: 'Load list',
      description:
        'Load one list. Decks return { slug, deck, frontMatter }; collections and wanted ' +
        'lists return { slug, entries, sectionOrder }.',
      inputSchema: { listType: listTypeSchema, slug: slugField },
      annotations: { readOnlyHint: true },
    },
    async ({ listType, slug }) => jsonResult(await loadProjectedList(listType, slug)),
  )

  server.registerTool(
    'search_cards',
    {
      title: 'Search cards',
      description:
        'Search Scryfall for card names matching a query (up to 20 names), most popular first. ' +
        'A query that spells out a card name in full is returned first.',
      inputSchema: { query: z.string().min(1).describe('Search text.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => jsonResult(await callApi('POST', '/api/search-cards', { query })),
  )

  server.registerTool(
    'autocomplete_card',
    {
      title: 'Autocomplete card name',
      description:
        'Autocomplete card names by prefix/substring, ignoring case, accents, and punctuation ' +
        '(up to 20). A query that spells out a card name in full is returned first.',
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
      description:
        'Get a card’s representative printing and cheapest printing per currency. ' +
        'An unknown card name is an error.',
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
    'price_report',
    {
      title: 'Price report',
      description:
        'Price lists from the local card cache. With listType + slug, one list’s summary plus ' +
        'its priced card entries; with listType alone, per-list totals across every list of ' +
        'that type; with neither, per-list totals across every list. Errors when the card ' +
        'cache is empty (run refresh_cache first).',
      inputSchema: z
        .object({
          listType: listTypeSchema
            .optional()
            .describe('Restrict to one list type (alone) or name one list (with slug).'),
          slug: slugField.optional(),
          currency: currencySchema
            .optional()
            .describe('Pricing currency; defaults to the configured defaultCurrency.'),
        })
        .superRefine((val, ctx) => {
          if (val.slug !== undefined && val.listType === undefined) {
            ctx.addIssue({
              code: 'custom',
              message: 'slug requires listType (omit both for the all-lists summary).',
            })
          }
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ listType, slug, currency }) => {
      if (listType !== undefined && slug !== undefined) {
        const query = currency === undefined ? '' : `?currency=${currency}`
        return jsonResult(
          await callApi('GET', `/api/price/${listType}/${encodeURIComponent(slug)}${query}`),
        )
      }
      const params = new URLSearchParams()
      if (listType !== undefined) params.set('type', listType)
      if (currency !== undefined) params.set('currency', currency)
      const query = params.size > 0 ? `?${params}` : ''
      return jsonResult(await callApi('GET', `/api/price/summary${query}`))
    },
  )

  server.registerTool(
    'load_history',
    {
      title: 'Load change history',
      description: 'Load a list’s change history (newest first) plus the default-rewrite lines.',
      inputSchema: { listType: listTypeSchema, slug: slugField },
      annotations: { readOnlyHint: true },
    },
    async ({ listType, slug }) =>
      jsonResult(await callApi('GET', `/api/history/${listType}/${encodeURIComponent(slug)}`)),
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

  server.registerTool(
    'diff_lists',
    {
      title: 'Diff lists',
      description:
        'Compare two lists (any mix of deck/collection/wanted). by "name" (default) matches on ' +
        'the card name, aggregating printings per side; by "printing" matches on name + set + ' +
        'collector number + finish (a missing finish counts as nonfoil, and lines with no ' +
        'printing form their own bucket). Returns { a, b, by, matches, onlyInA, onlyInB, ' +
        'warnings } with quantities summed across all sections.',
      inputSchema: {
        a: diffSideSchema.describe('First list.'),
        b: diffSideSchema.describe('Second list.'),
        by: z.enum(DIFF_BY_MODES).optional().describe('Identity to compare by (default "name").'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ a, b, by }) => {
      const params = new URLSearchParams()
      params.set('a', diffSideParam(a))
      params.set('b', diffSideParam(b))
      if (by !== undefined) params.set('by', by)
      return jsonResult(await callApi('GET', `/api/diff?${params}`))
    },
  )

  server.registerTool(
    'export_cards',
    {
      title: 'Export cards',
      description:
        'Render a CSV or JSON export of cards from decks, collections, and wanted lists. ' +
        'Select whole lists and/or pick cards by name terms; filter by name, set, finish, or ' +
        'condition; choose the columns and their order. With no lists and no cards, every ' +
        'list is exported. Returns { format, entryCount, content, warnings } — the content ' +
        'string is the rendered export (nothing is written to disk).',
      inputSchema: {
        lists: z
          .array(
            z.object({
              listType: listTypeSchema
                .optional()
                .describe('Pin the list type of an ambiguous name.'),
              name: z
                .string()
                .min(1)
                .describe(
                  'List name (matched like CLI list arguments; a slug/file basename also works).',
                ),
            }),
          )
          .optional()
          .describe('Lists to export whole.'),
        cards: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Card picks: each entry is whitespace-separated name terms; every entry across ' +
              'all lists whose name matches all terms is added.',
          ),
        filters: z
          .object({
            name: z.string().optional().describe('Only cards whose name contains every term.'),
            set: z.string().optional().describe('Only cards from this set code.'),
            finish: finishSchema
              .optional()
              .describe('Only this finish; nonfoil also matches unmarked cards.'),
            conditions: z
              .array(z.enum([...VALID_CONDITIONS, 'none']))
              .optional()
              .describe(
                'Only cards with one of these conditions. An explicit grade matches only cards ' +
                  "with it marked; 'none' matches cards without one. Wanted entries never match.",
              ),
          })
          .optional(),
        format: z.enum(['csv', 'json']).optional().describe('Output format (default csv).'),
        columns: z
          .array(z.enum(EXPORT_PROPERTIES))
          .optional()
          .describe('Columns to export, in output order.'),
        header: z.boolean().optional().describe('CSV: include the header row (default true).'),
        quoteAll: z.boolean().optional().describe('CSV: quote every cell (default false).'),
        preset: z
          .string()
          .optional()
          .describe('Start from a saved export preset; explicit fields override it.'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ lists, ...rest }) =>
      jsonResult(
        await callApi('POST', '/api/export', {
          ...rest,
          lists: lists?.map((l) => ({ type: l.listType, name: l.name })),
        }),
      ),
  )
}
