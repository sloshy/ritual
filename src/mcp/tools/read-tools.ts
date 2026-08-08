import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { callApi, callApiData } from '../dispatch'
import { loadProjectedList, type ListProjection } from '../projection'
import { runTool } from '../result'
import {
  AUTOCOMPLETE_CARD_OUTPUT,
  CONFIG_OUTPUT,
  DIFF_LISTS_OUTPUT,
  EXPORT_CARDS_OUTPUT,
  FIND_CARDS_OUTPUT,
  GET_BUYLIST_QUOTES_OUTPUT,
  GET_CACHE_STATUS_OUTPUT,
  GET_CARD_DETAILS_OUTPUT,
  GET_CARD_PRICE_OUTPUT,
  GET_CARD_PRINTINGS_OUTPUT,
  GET_HISTORY_OUTPUT,
  GET_LIST_OUTPUT,
  GET_PRICE_REPORT_OUTPUT,
  GET_SELL_CART_OUTPUT,
  GET_SELL_REPORT_OUTPUT,
  GET_SYNC_STATUS_OUTPUT,
  LIST_LISTS_OUTPUT,
  SEARCH_SCRYFALL_OUTPUT,
} from '../schema-json'
import {
  currencySchema,
  finishSchema,
  languageSchema,
  listRefSchema,
  listSlugRefSchema,
  listTypeSchema,
  setCodeField,
  setField,
  slugField,
  type ListRefInput,
} from '../schemas'
import type { AutocompleteResponse } from '../../api/autocomplete'
import type { CardDetailsSuccess } from '../../api/card-details'
import type { CardPriceResponse } from '../../api/card-price'
import type { CardPrintingsSuccess } from '../../api/card-printings'
import type { CardSearchSuccess } from '../../api/card-search'
import type { CacheStatusResponse } from '../../admin/api/cache'
import type { CardIndexResponse } from '../../admin/api/card-index'
import type { ConfigResponse } from '../../admin/api/config'
import type { DiffResponseBody } from '../../admin/api/diff'
import type { HistoryLoadResponse } from '../../admin/api/history'
import type { PriceListDetailResponse, PriceSummaryResponse } from '../../admin/api/price'
import type { SellCartResponse, SellReportResponse } from '../../admin/api/sell'
import type {
  CollectionSyncList,
  CollectionSyncStatusResponse,
} from '../../admin/api/collection-sync'
import type { DeckSyncStatusResponse } from '../../admin/api/deck-sync'
import type { ExportRequestBody, ExportResponseBody } from '../../admin/api/export'
import type { ArchidektLoginStatus } from '../../auth/interfaces'
import type { MovePhysicalCard } from '../../card-index-types'
import type { SyncableDeck } from '../../deck-sync/engine'
import { EXPORT_FORMATS } from '../../export/presets'
import { EXPORT_DIALECTS, EXPORT_PROPERTIES } from '../../export/render'
import { VALID_CONDITIONS, VALID_FINISHES } from '../../finish-condition'
import { CARD_LABELS } from '../../card-labels'
import { BUYERS, type BuylistQuotesResponse } from '../../buylist'
import { MAX_BUYLIST_PRINTINGS } from '../../api/buylist'
import { DIFF_BY_MODES } from '../../list-diff'
import type { ListInfo } from '../../list-info'
import type { ListType } from '../../list-type'
import type {
  CacheStatusResult,
  CardDetails,
  ConfigResult,
  ListsResponse,
  OmitSuccess,
  PrintingListing,
  PrintingSummary,
} from '../types'
import {
  summarizePrinting,
  summarizePrintingIdentity,
  summarizePrintingOrNull,
} from '../../api/card-summary'

/**
 * How every tool names a list: `listType` + `slug`, exactly the pair the tools
 * take as arguments, plus the display name. One vocabulary across `list_lists`,
 * `find_cards`' roster, and both sides of `diff_lists`, so a list named by one
 * can be handed straight to another. The engine-side `ListInfo` still spells the
 * first field `type`; this is where that is normalized for the tool surface.
 */
export interface ListRefResult {
  listType: ListType
  slug: string
  name: string
}

/** Project the engine's list summary into the tool vocabulary. */
function toListRef(list: ListInfo): ListRefResult {
  return { listType: list.type, slug: list.slug, name: list.name }
}

/** `list_lists` result: every (optionally type-filtered) list as a summary. */
export interface ListListsResult {
  lists: ListRefResult[]
}

/**
 * `get_card_printings` result. Printings carry prices only when the caller asked
 * for them: the price block is roughly half a printing's bytes and is beside the
 * point when the question is "which printings exist".
 */
export interface CardPrintingsResult {
  name: string
  printings: PrintingListing[]
  /**
   * Distinct set:collectorNumber printings found before `limit` truncated the
   * list; absent when nothing was dropped. With an `all_cards`-backed cache a
   * printing can appear once per language, and the count is of printings, not
   * per-language card objects.
   */
  totalPrintings?: number
  /**
   * Every language the card's full printing list exists in (`en` first),
   * folding an absent `lang` to `en`. `["en"]` for any English-only
   * (default_cards-backed) cache.
   */
  languages: string[]
  /**
   * Whether the list is the card's complete printing set. False when the local
   * card cache holds no bulk-downloaded entry for the name — the one printing
   * shown then came from a single Scryfall lookup and is not "the only one".
   */
  complete: boolean
}

/** `get_sync_status`, decks half — what `GET /api/deck-sync` returns, minus `success`. */
export interface DeckSyncStatusSection {
  decks: SyncableDeck[]
  archidekt: ArchidektLoginStatus
}

/** `get_sync_status`, collection half — what `GET /api/collection-sync` returns, minus `success`. */
export interface CollectionSyncStatusSection {
  lists: CollectionSyncList[]
  archidekt: ArchidektLoginStatus
  lastSynced: string | null
  pullTarget: string
  csvThreshold: number
}

/**
 * `get_sync_status` result: whichever halves `target` asked for. Deliberately
 * two keys rather than one merged shape — the account has one Archidekt
 * collection but many linked decks, so the two halves genuinely differ.
 */
export interface SyncStatusResult {
  decks?: DeckSyncStatusSection
  collection?: CollectionSyncStatusSection
}

/** `find_cards` result: the matching physical cards, plus the list roster when asked for. */
export interface FindCardsResult {
  cards: MovePhysicalCard[]
  /** Every list, unfiltered — only present when `includeLists` was set. */
  lists?: ListRefResult[]
  /** Read/parse problems hit while building the index; empty when every list read cleanly. */
  warnings: string[]
}

/**
 * `get_card_price` result. The route's `lowestPriceCard*` fields are renamed to the
 * tool vocabulary here, so this type is the only record of that mapping.
 */
export interface CardPriceResult {
  name: string
  representative: PrintingSummary | null
  lowestUsd: PrintingSummary | null
  lowestEur: PrintingSummary | null
  lowestTix: PrintingSummary | null
}

/** `search_scryfall` result: one page of a raw Scryfall search. */
export type CardSearchResult = OmitSuccess<CardSearchSuccess>

/** `autocomplete_card` result: matching card names from the local cache. */
export type AutocompleteResult = OmitSuccess<AutocompleteResponse>

/** `get_price_report` result: the summary or the single-list body, keyed by `mode`. */
export type PriceReportResult = OmitSuccess<PriceSummaryResponse | PriceListDetailResponse>

/** `get_sell_report` result: entries matched against the Card Kingdom buylist. */
export type SellReportResult = OmitSuccess<SellReportResponse>

/** `get_sell_cart` result: the CK sell-cart CSV plus its size against their caps. */
export type SellCartResult = OmitSuccess<SellCartResponse>

/** The scope/filter input shared by `get_sell_report` and `get_sell_cart`. */
const sellScopeSchema = z.object({
  listType: listTypeSchema
    .optional()
    .describe('Match every list of this type (default: collections).'),
  lists: z
    .array(listSlugRefSchema)
    .optional()
    .describe('Match exactly these lists instead of a whole type.'),
  sets: z.array(setCodeField).optional().describe('Only cards from these set codes.'),
  minPrice: z
    .number()
    .min(0)
    .optional()
    .describe('Only offers of at least this much per copy (USD).'),
})

type SellScopeInput = z.infer<typeof sellScopeSchema>

/** The admin sell endpoints' query string for a tool-scope input. */
function sellScopeQuery(scope: SellScopeInput): string {
  const params = new URLSearchParams()
  if (scope.lists !== undefined && scope.lists.length > 0) {
    params.set('lists', scope.lists.map((ref) => `${ref.listType}:${ref.slug}`).join(','))
  } else if (scope.listType !== undefined) {
    params.set('type', scope.listType)
  }
  if (scope.sets !== undefined && scope.sets.length > 0) params.set('sets', scope.sets.join(','))
  if (scope.minPrice !== undefined) params.set('min', String(scope.minPrice))
  return params.size > 0 ? `?${params}` : ''
}

/** `get_buylist_quotes` result: the buyer's offer for each requested printing. */
export type BuylistQuotesResult = OmitSuccess<BuylistQuotesResponse>

/** One printing to quote, in the shape the buylist endpoint accepts. */
const buylistPrintingSchema = z.object({
  set: setCodeField.describe('Set code of the printing.'),
  collectorNumber: z.string().min(1).describe('Collector number of the printing.'),
  finish: z.enum(VALID_FINISHES).describe('Finish of the copy being quoted.'),
  language: languageSchema
    .optional()
    .describe(
      'Language of the copy being quoted; omitted means English. The buyer only quotes ' +
        'English copies, so a non-English copy gets no quote.',
    ),
  scryfallId: z
    .string()
    .optional()
    .describe('Scryfall id of this exact printing — the primary join key when known.'),
})

/** `get_history` result: a list's change sets plus the default-rewrite lines. */
export type HistoryResult = OmitSuccess<HistoryLoadResponse>

/** `diff_lists` result: the two sides, the matches, and each side's exclusives. */
export type DiffResult = OmitSuccess<DiffResponseBody>

/** `export_cards` result: the rendered content, or the file written. */
export type ExportResult = OmitSuccess<ExportResponseBody>

/** The `[type:]name` query value the admin diff route expects for one side. */
function diffSideParam(side: ListRefInput): string {
  return side.listType === undefined ? side.name : `${side.listType}:${side.name}`
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
      inputSchema: z.object({
        listType: listTypeSchema.optional().describe('Only return lists of this type.'),
      }),
      outputSchema: fromJsonSchema<ListListsResult>(LIST_LISTS_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ listType }) =>
      runTool(async (): Promise<ListListsResult> => {
        const data = (await callApi('GET', '/api/lists')) as ListsResponse
        const lists = listType ? data.lists.filter((l) => l.type === listType) : data.lists
        return { lists: lists.map(toListRef) }
      }),
  )

  server.registerTool(
    'get_sync_status',
    {
      title: 'Get sync status',
      description:
        'Report what an Archidekt sync can cover, and whether one can run at all. Omit target ' +
        'for both halves: decks are what sync_decks operates on, collection is what a ' +
        'sync_collection run can cover. Both halves carry the stored Archidekt login, whose ' +
        'loginRequired flag says whether the matching sync tool can run.',
      inputSchema: z.object({
        target: z
          .enum(['decks', 'collection'])
          .optional()
          .describe('Which half to report; omit for both.'),
      }),
      outputSchema: fromJsonSchema<SyncStatusResult>(GET_SYNC_STATUS_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ target }) =>
      runTool(async (): Promise<SyncStatusResult> => {
        const result: SyncStatusResult = {}
        if (target === undefined || target === 'decks') {
          const data = (await callApi('GET', '/api/deck-sync')) as DeckSyncStatusResponse
          result.decks = { decks: data.decks, archidekt: data.archidekt }
        }
        if (target === undefined || target === 'collection') {
          const data = (await callApi(
            'GET',
            '/api/collection-sync',
          )) as CollectionSyncStatusResponse
          result.collection = {
            lists: data.lists,
            archidekt: data.archidekt,
            lastSynced: data.lastSynced,
            pullTarget: data.pullTarget,
            csvThreshold: data.csvThreshold,
          }
        }
        return result
      }),
  )

  server.registerTool(
    'get_list',
    {
      title: 'Get list',
      description:
        'Read one list. view "summary" returns counts only — cheap, and the right first call on ' +
        'a list you have not seen. section and nameContains filter in either view; limit and ' +
        'offset page the cards view and are ignored by summary, whose counts always describe the ' +
        'whole filtered set. totalCount reports how many entries matched before limit and offset ' +
        'applied, so you can page.',
      inputSchema: z.object({
        listType: listTypeSchema,
        slug: slugField,
        view: z
          .enum(['cards', 'summary'])
          .optional()
          .describe('"summary" returns counts only (default "cards").'),
        section: z
          .string()
          .min(1)
          .optional()
          .describe('Exact section name (the markdown "## Section" heading); omit for all.'),
        nameContains: z
          .string()
          .min(1)
          .optional()
          .describe('Whitespace-separated name terms; every term must appear, in any order.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .optional()
          .describe('Max entries returned; totalCount reports the full match count.'),
        offset: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .optional()
          .describe('Entries to skip (with limit, for paging).'),
      }),
      outputSchema: fromJsonSchema<ListProjection>(GET_LIST_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ listType, slug, ...query }) =>
      runTool((): Promise<ListProjection> => loadProjectedList(listType, slug, query)),
  )

  server.registerTool(
    'search_scryfall',
    {
      title: 'Search Scryfall',
      description:
        'Search the live Scryfall API with its raw query syntax (e.g. "t:goblin c:r cmc<=2") and ' +
        'return card summaries — name, set, collector number, rarity, mana cost, CMC, type line, ' +
        'oracle text, color identity, prices — most popular first. The name says the data ' +
        'source: this always goes to the network, unlike find_cards (your own lists) and ' +
        'autocomplete_card (the local card cache). ' +
        'warm additionally writes results into the local card cache under names it does not ' +
        'already hold, and moves a card whose whole name the query spells out to the front; it ' +
        'writes to the cache only, never to your lists. One result page is fetched per call; ' +
        'walk further pages with page while hasMore is true.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Scryfall query syntax, e.g. "t:goblin c:r cmc<=2".'),
        page: z
          .number()
          .int()
          .min(1)
          .max(1_000)
          .optional()
          .describe('1-based result page (default 1).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(175)
          .optional()
          .describe('Max cards returned (default 20 when warm, otherwise the whole page).'),
        warm: z
          .boolean()
          .optional()
          .describe(
            'Also cache the results under names the local cache lacks, and promote full-name ' +
              'matches. Default false.',
          ),
      }),
      outputSchema: fromJsonSchema<CardSearchResult>(SEARCH_SCRYFALL_OUTPUT),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, page, limit, warm }) =>
      runTool(async (): Promise<CardSearchResult> => {
        const params = new URLSearchParams({ q: query })
        if (page !== undefined) params.set('page', String(page))
        if (limit !== undefined) params.set('limit', String(limit))
        if (warm !== undefined) params.set('warm', String(warm))
        // The success variant: `callApi` throws on a non-2xx, so a failure body
        // never reaches here.
        const rest = await callApiData<CardSearchSuccess>('GET', `/api/card-search?${params}`)
        return rest
      }),
  )

  server.registerTool(
    'autocomplete_card',
    {
      title: 'Autocomplete card name',
      description:
        'Autocomplete card names from the local cache (up to 20), ignoring case, accents, and ' +
        'punctuation. Every whitespace-separated term must appear in the name, in any order, so ' +
        '"in tre" finds "In the Trenches". Closest matches first: a name spelled out in full, ' +
        'then names the query prefixes, then names whose words the terms begin.',
      inputSchema: z.object({ query: z.string().min(1).describe('Partial card name.') }),
      outputSchema: fromJsonSchema<AutocompleteResult>(AUTOCOMPLETE_CARD_OUTPUT),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) =>
      runTool(async (): Promise<AutocompleteResult> => {
        const data = (await callApi(
          'GET',
          `/api/autocomplete?q=${encodeURIComponent(query)}`,
        )) as AutocompleteResponse
        return { names: data.names }
      }),
  )

  server.registerTool(
    'find_cards',
    {
      title: 'Find cards in your lists',
      description:
        'Find where a card physically lives across every deck, collection, and wanted list — the ' +
        'local cross-list index, no network. Each result is one physical copy (a deck line with ' +
        'quantity 3 yields three), carrying exactly the fields move_selected_cards and ' +
        'remove_selected_cards address entries by. Filters intersect: name matches every ' +
        'whitespace-separated term in any order (as autocomplete_card matches), listType/slug/set ' +
        'match exactly. warnings names any list file that could not be fully read, so an empty ' +
        'result is never silently wrong.',
      inputSchema: z.object({
        name: z.string().min(1).optional().describe('Whitespace-separated name terms.'),
        listType: listTypeSchema.optional().describe('Only cards in lists of this type.'),
        slug: slugField.optional().describe('Only cards in this list.'),
        set: setField.describe('Only cards of this set code.'),
        includeLists: z
          .boolean()
          .optional()
          .describe(
            'Also return every list as { listType, slug, name } — the destinations a move can ' +
              'name. Default false; the roster does not depend on the filters.',
          ),
      }),
      outputSchema: fromJsonSchema<FindCardsResult>(FIND_CARDS_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ name, listType, slug, set, includeLists }) =>
      runTool(async (): Promise<FindCardsResult> => {
        const params = new URLSearchParams()
        if (name !== undefined) params.set('name', name)
        if (listType !== undefined) params.set('listType', listType)
        if (slug !== undefined) params.set('slug', slug)
        if (set !== undefined) params.set('set', set)
        const query = params.size > 0 ? `?${params}` : ''
        const data = (await callApi('GET', `/api/card-index${query}`)) as CardIndexResponse
        const result: FindCardsResult = { cards: data.cards, warnings: data.warnings }
        if (includeLists === true) result.lists = data.lists.map(toListRef)
        return result
      }),
  )

  server.registerTool(
    'get_card_details',
    {
      title: 'Get card details',
      description:
        'Everything known about one card from the local Scryfall cache: oracle text, type line, ' +
        'mana cost and CMC, colors and color identity, keywords, format legalities, Scryfall ' +
        'Tagger oracle/art tags, the faces of a multi-faced card, and how many printings exist. ' +
        'A false `printingsComplete` means the cache holds no printing list for the name, so ' +
        '`printingCount` is only what one Scryfall lookup returned. ' +
        'Names are matched exactly and case-sensitively — resolve a partial name with ' +
        'autocomplete_card first.',
      inputSchema: z.object({ name: z.string().min(1).describe('Exact card name.') }),
      outputSchema: fromJsonSchema<CardDetails>(GET_CARD_DETAILS_OUTPUT),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name }) =>
      runTool(async (): Promise<CardDetails> => {
        // The success variant, for the same reason as `get_card_printings`: a
        // failure body is thrown by `callApi`, so `card` is never null here.
        const data = (await callApi(
          'GET',
          `/api/card-details?name=${encodeURIComponent(name)}`,
        )) as CardDetailsSuccess
        return data.card
      }),
  )

  server.registerTool(
    'get_card_printings',
    {
      title: 'Get card printings',
      description:
        'List the printings of a card, newest first, which is what a set/collectorNumber ' +
        'argument on the edit tools needs. Capped at 20 distinct printings by default; with a ' +
        'non-English cache every language object of an included printing rides along (its lang ' +
        'field says which — absent means "en"), and languages summarizes every language the ' +
        'card exists in. Prices are left out unless ' +
        'includePrices is set; use get_card_price for the cheapest and representative printings ' +
        'instead. When `complete` is false the local card cache holds no printing list for this ' +
        'name, so the printings shown are whatever one lookup returned — run refresh_cache before ' +
        'concluding a card has only one printing.',
      inputSchema: z.object({
        name: z.string().min(1).describe('Exact card name.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1_000)
          .optional()
          .describe('Max printings returned (default 20, newest first).'),
        includePrices: z
          .boolean()
          .optional()
          .describe('Include each printing’s price block. Default false.'),
      }),
      outputSchema: fromJsonSchema<CardPrintingsResult>(GET_CARD_PRINTINGS_OUTPUT),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, limit, includePrices }) =>
      runTool(async (): Promise<CardPrintingsResult> => {
        const params = new URLSearchParams({ name, limit: String(limit ?? 20) })
        // The success variant: `callApi` throws on a non-2xx, so a failure body
        // never reaches here.
        const data = (await callApi('GET', `/api/card-printings?${params}`)) as CardPrintingsSuccess
        const result: CardPrintingsResult = {
          name,
          printings: data.printings.map(
            includePrices === true ? summarizePrinting : summarizePrintingIdentity,
          ),
          languages: data.languages,
          complete: data.complete,
        }
        if (data.totalPrintings !== undefined) result.totalPrintings = data.totalPrintings
        return result
      }),
  )

  server.registerTool(
    'get_card_price',
    {
      title: 'Get card price',
      description:
        'Get a card’s representative printing and cheapest printing per currency. ' +
        'An unknown card name is an error.',
      inputSchema: z.object({ name: z.string().min(1).describe('Exact card name.') }),
      outputSchema: fromJsonSchema<CardPriceResult>(GET_CARD_PRICE_OUTPUT),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name }) =>
      runTool(async (): Promise<CardPriceResult> => {
        const data = (await callApi(
          'GET',
          `/api/card-price?name=${encodeURIComponent(name)}`,
        )) as CardPriceResponse
        return {
          name,
          representative: summarizePrintingOrNull(data.representative),
          lowestUsd: summarizePrintingOrNull(data.lowestPriceCard),
          lowestEur: summarizePrintingOrNull(data.lowestPriceCardEur),
          lowestTix: summarizePrintingOrNull(data.lowestPriceCardTix),
        }
      }),
  )

  server.registerTool(
    'get_price_report',
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
      outputSchema: fromJsonSchema<PriceReportResult>(GET_PRICE_REPORT_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ listType, slug, currency }) =>
      runTool(async (): Promise<PriceReportResult> => {
        if (listType !== undefined && slug !== undefined) {
          const query = currency === undefined ? '' : `?currency=${currency}`
          const detail = await callApiData<PriceListDetailResponse>(
            'GET',
            `/api/price/${listType}/${encodeURIComponent(slug)}${query}`,
          )
          return detail
        }
        const params = new URLSearchParams()
        if (listType !== undefined) params.set('type', listType)
        if (currency !== undefined) params.set('currency', currency)
        const query = params.size > 0 ? `?${params}` : ''
        const summary = await callApiData<PriceSummaryResponse>('GET', `/api/price/summary${query}`)
        return summary
      }),
  )

  server.registerTool(
    'get_sell_report',
    {
      title: 'Sell report',
      description:
        'Match cards against the cached Card Kingdom buylist: what CK is buying, the cash ' +
        'quote per Near Mint copy, and their quantity caps. Scope with listType (default: ' +
        'collections) or lists; filter with sets / minPrice. Strictly cache-backed — errors ' +
        'when the card cache is empty (run refresh_cache) or no buylist feed has been ' +
        'downloaded (run refresh_buylist).',
      inputSchema: sellScopeSchema,
      outputSchema: fromJsonSchema<SellReportResult>(GET_SELL_REPORT_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async (scope) =>
      runTool(async (): Promise<SellReportResult> => {
        const data = await callApiData<SellReportResponse>(
          'GET',
          `/api/sell/report${sellScopeQuery(scope)}`,
        )
        return data
      }),
  )

  server.registerTool(
    'get_sell_cart',
    {
      title: 'Sell-cart CSV',
      description:
        'Render the cards CK is buying as their sell-cart CSV import format (card name, ' +
        'edition, foil, quantity, no header row — CK’s own listing titles, including their ' +
        'variant note for variant printings, quantities capped at their buy ' +
        'limits), over the same scope and filters as get_sell_report. Upload the csv at ' +
        'cardkingdom.com/static/csvImport; warnings flag CK’s 500-title/5,000-card upload ' +
        'caps and etched foils the format cannot express.',
      inputSchema: sellScopeSchema,
      outputSchema: fromJsonSchema<SellCartResult>(GET_SELL_CART_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async (scope) =>
      runTool(async (): Promise<SellCartResult> => {
        const data = await callApiData<SellCartResponse>(
          'GET',
          `/api/sell/cart${sellScopeQuery(scope)}`,
        )
        return data
      }),
  )

  server.registerTool(
    'get_buylist_quotes',
    {
      title: 'Buylist quotes',
      description:
        'Look up the buyer’s current offer for specific printings, keyed by ' +
        '"set:collectorNumber:finish". Use this to price an arbitrary set of cards ' +
        '(a trade, a selection) without building a whole sell report; use get_sell_report ' +
        'to price entire lists. Printings the buyer has no product for are simply absent ' +
        'from the result. Strictly cache-backed — errors when no buylist feed has been ' +
        'downloaded (run refresh_buylist).',
      inputSchema: z.object({
        printings: z
          .array(buylistPrintingSchema)
          .max(MAX_BUYLIST_PRINTINGS)
          .describe('The printings to quote.'),
        buyer: z
          .enum(BUYERS)
          .optional()
          .describe('Which buyer to quote against (default: cardkingdom).'),
      }),
      outputSchema: fromJsonSchema<BuylistQuotesResult>(GET_BUYLIST_QUOTES_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ printings, buyer }) =>
      runTool(async (): Promise<BuylistQuotesResult> => {
        const data = await callApiData<BuylistQuotesResponse>('POST', '/api/buylist/quotes', {
          printings,
          ...(buyer !== undefined ? { buyer } : {}),
        })
        return data
      }),
  )

  server.registerTool(
    'get_history',
    {
      title: 'Get change history',
      description: 'Load a list’s change history (newest first) plus the default-rewrite lines.',
      inputSchema: z.object({ listType: listTypeSchema, slug: slugField }),
      outputSchema: fromJsonSchema<HistoryResult>(GET_HISTORY_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ listType, slug }) =>
      runTool(async (): Promise<HistoryResult> => {
        const rest = await callApiData<HistoryLoadResponse>(
          'GET',
          `/api/history/${listType}/${encodeURIComponent(slug)}`,
        )
        return rest
      }),
  )

  server.registerTool(
    'get_config',
    {
      title: 'Get config',
      description:
        'Get the current Ritual configuration, including defaultLanguage — the Scryfall ' +
        'language code stamped on newly added cards (and what decides which Scryfall bulk ' +
        'backs the card cache) — and uiLocale, the unrelated BCP-47 tag naming the language ' +
        'the interface speaks. Two different settings; uiLocale costs nothing to change.',
      inputSchema: z.object({}),
      outputSchema: fromJsonSchema<ConfigResult>(CONFIG_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async () =>
      runTool(async (): Promise<ConfigResult> => {
        const data = (await callApi('GET', '/api/config')) as ConfigResponse
        return { config: data.config }
      }),
  )

  server.registerTool(
    'get_cache_status',
    {
      title: 'Get card cache status',
      description:
        'Report the local Scryfall card cache: whether it is empty, how many cards it holds, ' +
        'when it was last refreshed, how old its prices are and whether they are stale, whether ' +
        'Scryfall Tagger tags are present, where the cache is served from, and which Scryfall ' +
        'bulk built it (cardBulkType — default_cards for an English defaultLanguage, all_cards ' +
        'otherwise; bulkTypeStale means the cache and the configured defaultLanguage disagree ' +
        'and a full refresh_cache is needed). ' +
        'Check empty and priceStale before pricing: an empty or stale cache is exactly what ' +
        'get_price_report errors on, and refresh_cache is the fix. Diagnostic only — reading ' +
        'this never refreshes or writes the cache.',
      inputSchema: z.object({}),
      outputSchema: fromJsonSchema<CacheStatusResult>(GET_CACHE_STATUS_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async () =>
      runTool(async (): Promise<CacheStatusResult> => {
        const rest = await callApiData<CacheStatusResponse>('GET', '/api/cache/status')
        return rest
      }),
  )

  server.registerTool(
    'diff_lists',
    {
      title: 'Diff lists',
      description:
        'Compare two lists (any mix of deck/collection/wanted). by "name" (default) matches on ' +
        'the card name, aggregating printings per side; by "printing" matches on name + set + ' +
        'collector number + finish (a missing finish counts as nonfoil, and lines with no ' +
        'printing form their own bucket). Quantities are summed across all sections.',
      inputSchema: z.object({
        a: listRefSchema.describe('First list.'),
        b: listRefSchema.describe('Second list.'),
        by: z.enum(DIFF_BY_MODES).optional().describe('Identity to compare by (default "name").'),
      }),
      outputSchema: fromJsonSchema<DiffResult>(DIFF_LISTS_OUTPUT),
      annotations: { readOnlyHint: true },
    },
    async ({ a, b, by }) =>
      runTool(async (): Promise<DiffResult> => {
        const params = new URLSearchParams()
        params.set('a', diffSideParam(a))
        params.set('b', diffSideParam(b))
        if (by !== undefined) params.set('by', by)
        const rest = await callApiData<DiffResponseBody>('GET', `/api/diff?${params}`)
        return rest
      }),
  )

  server.registerTool(
    'export_cards',
    {
      title: 'Export cards',
      description:
        'Render a CSV, JSON, plain-text, or Markdown export of cards from decks, collections, ' +
        'and wanted lists. Select whole lists and/or pick cards by name terms; filter by name, ' +
        'set, finish, condition, or labels; choose the columns and their order (csv/json only — ' +
        'text and md have fixed line formats). With no lists and no cards, every list is exported. ' +
        'By default the rendered export comes back inline and nothing is written to disk; with ' +
        'write: true it instead writes a server-named file under exports/ in the base dir and ' +
        'returns its path (an existing file is never overwritten). Registered with the read tools ' +
        'because content mode is the common case; write mode is why it carries no readOnlyHint.',
      inputSchema: z.object({
        lists: z.array(listRefSchema).optional().describe('Lists to export whole.'),
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
            labels: z
              .array(z.enum([...CARD_LABELS, 'none']))
              .optional()
              .describe(
                'Only collection cards whose effective labels (their override, else the list ' +
                  "default) include one of these; 'none' matches unlabeled cards. Deck and " +
                  'wanted entries never match.',
              ),
          })
          .optional(),
        format: z
          .enum(EXPORT_FORMATS)
          .optional()
          .describe(
            'Output format (default csv): csv, json, text (one flat plain-text decklist), ' +
              'or md (canonical list markdown without &N ids).',
          ),
        columns: z
          .array(z.enum(EXPORT_PROPERTIES))
          .optional()
          .describe(
            'Columns to export, in output order. scryfallId is resolved from the local ' +
              'Scryfall cache; an uncached printing exports an empty cell and a warning.',
          ),
        header: z.boolean().optional().describe('CSV: include the header row (default true).'),
        quoteAll: z.boolean().optional().describe('CSV: quote every cell (default false).'),
        dialect: z
          .enum(EXPORT_DIALECTS)
          .optional()
          .describe(
            "csv/json value spellings (default ritual): archidekt writes Archidekt's " +
              'finish/condition words (Normal|Foil|Etched, NM|LP|MP|HP|D) under a Variant header.',
          ),
        preset: z
          .string()
          .optional()
          .describe(
            'Start from a saved or built-in export preset; explicit fields override it. ' +
              "Built-in: archidekt (the CSV Archidekt's collection importer takes).",
          ),
        write: z
          .boolean()
          .optional()
          .describe(
            'Write the export to a server-named file under exports/ and return its path ' +
              'instead of the content. Default false.',
          ),
      }),
      outputSchema: fromJsonSchema<ExportResult>(EXPORT_CARDS_OUTPUT),
      // No readOnlyHint: write mode touches the filesystem. No destructiveHint
      // either — the writer never overwrites an existing file.
      annotations: {},
    },
    async ({ lists, ...rest }) =>
      runTool(async (): Promise<ExportResult> => {
        const body: ExportRequestBody = {
          ...rest,
          lists: lists?.map((l) => ({ type: l.listType, name: l.name })),
        }
        const response = await callApiData<ExportResponseBody>('POST', '/api/export', body)
        return response
      }),
  )
}
