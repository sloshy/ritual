/**
 * Hand-authored JSON Schema for every tool's `outputSchema`.
 *
 * **Why hand-authored, when the input schemas are zod.** The SDK converts a
 * Standard Schema by calling `schema['~standard'].jsonSchema[io]({ target })`
 * and nothing else — it never populates zod's `libraryOptions`. Named `$defs`
 * survive that path (`.meta({ id })` emits the `$ref` and the fragment), but
 * four of the bytes below do not: zod always emits `$schema`, stamps
 * `additionalProperties: false` on every `z.object`, spells every nullable as a
 * two-arm `anyOf` — which is what `nullable()` emits here too, except in
 * `CARD_PRICES`, whose `additionalProperties` is the compact
 * `type: ['string', 'null']` — and adds `propertyNames` to a `z.record`. Rules 2 and 4 are the two that a zod
 * rewrite could not keep, and rule 4 is a forward-compatibility property, not a
 * byte count. `fromJsonSchema()` accepts raw JSON Schema (Ajv-validated for
 * real at call time) and is the only route to exactly these bytes. It costs the
 * callback's inferred argument types (`fromJsonSchema<T = unknown>`), which is
 * why **inputs stay on zod**: typed handler arguments are worth more than
 * schema compression there, while an output schema has no arguments to lose.
 *
 * **Authoring rules**, each of which is pinned by
 * `test/unit/mcp/output-schemas.test.ts`:
 *
 * 1. Object root, always (`"type": "object"`). The 2025-era codec re-wraps a
 *    non-object-rooted schema *and* its values as `{result: …}`; an object root
 *    makes the two eras agree byte for byte.
 * 2. No `$schema` — the SDK's conversion target is draft 2020-12 regardless, and
 *    the key would cost ~1.6 KB across the catalogue.
 * 3. No `format`. The SDK's Ajv is built with `validateFormats: true`, so a
 *    timestamp that is ISO-ish but not RFC3339-strict would turn a working tool
 *    into an `isError` result.
 * 4. No `additionalProperties: false`. Leniency by omission is what lets a
 *    widened handler response ship without breaking a running server.
 * 5. No numeric bounds. `minimum`/`maximum` guide a *caller*, so they belong on
 *    inputs; the catalogue-wide `9007199254740991` purge assertion covers these
 *    bytes too.
 * 6. `required` lists a property only when the TS result type has it
 *    non-optional **and** the handler always sets it. Ajv rejects a missing
 *    required key at runtime, so an over-tight schema breaks the call while an
 *    over-loose one merely costs an agent a little clarity.
 */

import type { JsonSchemaType } from '@modelcontextprotocol/server'
import { DECK_FORMAT_KEYS } from '../list/deck-format'
import type { McpToolName } from './tools/names'
import { VALID_FINISHES } from '../card/finish-condition'
import { CARD_LANGUAGES } from '../card/card-language'
import { CARD_BULK_TYPES } from '../scryfall/bulk-manifest'
import { VALID_CURRENCIES } from '../pricing/price-currency'
import { DIFF_BY_MODES } from '../changes/list-diff'
import { BUYERS, SELL_MATCH_VIAS } from '../buylist'
import { SELL_ENTRY_STATUSES, SELL_NO_MATCH_REASONS } from '../pricing/sell-report'
import { REPORT_PRICE_SOURCES } from '../pricing/price-report'
import type { SessionOverrides } from '../config/ritual-config'
import {
  CARD_ART_REF,
  CARD_LABEL,
  CARD_SUMMARY_PROPS,
  CONDITION,
  CUSTOM_ART_MAP,
  FINISH,
  LIST_IMAGE_REF,
  LIST_TYPE,
  PRINTING_IDENTITY_REQUIRED,
  arr,
  bool,
  enumOf,
  int,
  literal,
  nullable,
  nullableStr,
  num,
  obj,
  openObject,
  ref,
  str,
  withDefs,
  type Properties,
} from './schema-defs'

// ── Per-tool output schemas ───────────────────────────────────────────

export const LIST_LISTS_OUTPUT: JsonSchemaType = withDefs(
  obj({ lists: arr(ref('ListRef')) }, ['lists']),
  'ListRef',
)

export const GET_SYNC_STATUS_OUTPUT: JsonSchemaType = withDefs(
  obj({ decks: ref('DeckSyncStatusSection'), collection: ref('CollectionSyncStatusSection') }),
  'DeckSyncStatusSection',
  'CollectionSyncStatusSection',
)

/** What every `get_list` arm carries besides its two discriminants. */
const GET_LIST_COMMON_PROPS = {
  slug: str(),
  warnings: arr(
    str(),
    'Lines the parser could not read; always present, empty when the file is clean.',
  ),
} as const satisfies Properties
const GET_LIST_COMMON_REQUIRED = ['view', 'listType', 'slug', 'warnings'] as const

/** What the two `cards` arms carry beyond that; the summary arm reports counts instead. */
const GET_LIST_CARDS_PROPS = {
  totalCount: int('Lines that matched before limit/offset applied.'),
  artWarnings: arr(
    str(),
    'Problems with the list’s custom-art sidecar (unreadable, or art for cards that are gone). ' +
      'Separate from warnings: these never block a mutation. Absent when the sidecar is clean.',
  ),
} as const satisfies Properties

export const GET_LIST_OUTPUT: JsonSchemaType = withDefs(
  {
    type: 'object',
    description: 'One list, discriminated by `view` and `listType`.',
    oneOf: [
      obj(
        {
          view: literal('cards'),
          listType: literal('deck'),
          ...GET_LIST_COMMON_PROPS,
          deck: ref('DeckData'),
          frontMatter: openObject('The deck’s YAML front matter, verbatim.'),
          labels: arr(
            CARD_LABEL,
            'The deck’s default card labels from front matter ("proxy" alone); a card’s own labels override them.',
          ),
          image: LIST_IMAGE_REF,
          customArt: CUSTOM_ART_MAP,
          ...GET_LIST_CARDS_PROPS,
        },
        [...GET_LIST_COMMON_REQUIRED, 'deck', 'frontMatter', 'totalCount'],
      ),
      obj(
        {
          view: literal('cards'),
          listType: enumOf(['collection', 'wanted']),
          ...GET_LIST_COMMON_PROPS,
          entries: arr({ anyOf: [ref('CollectionEntry'), ref('WantedEntry')] }),
          sectionOrder: arr(str(), 'Section names in file order.'),
          description: str('The list’s front-matter description, the blurb the site prints.'),
          labels: arr(
            CARD_LABEL,
            'The list’s default card labels from front matter (never on a wanted list).',
          ),
          image: LIST_IMAGE_REF,
          customArt: CUSTOM_ART_MAP,
          ...GET_LIST_CARDS_PROPS,
        },
        [...GET_LIST_COMMON_REQUIRED, 'entries', 'totalCount'],
      ),
      obj(
        {
          view: literal('summary'),
          listType: LIST_TYPE,
          ...GET_LIST_COMMON_PROPS,
          counts: ref('ListCounts'),
        },
        [...GET_LIST_COMMON_REQUIRED, 'counts'],
      ),
    ],
  },
  'DeckData',
  'CollectionEntry',
  'WantedEntry',
  'ListCounts',
)

export const SEARCH_SCRYFALL_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      page: int('1-based result page actually fetched.'),
      hasMore: bool('Whether Scryfall reports further pages.'),
      totalCards: int('Matches across all pages, when Scryfall reported them.'),
      warmed: bool('Whether the results were also written into the local card cache.'),
      cards: arr(ref('CardSummary')),
    },
    ['page', 'hasMore', 'warmed', 'cards'],
  ),
  'CardSummary',
)

export const AUTOCOMPLETE_CARD_OUTPUT: JsonSchemaType = obj(
  { names: arr(str(), 'Matching card names, closest first.') },
  ['names'],
)

export const FIND_CARDS_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      cards: arr(ref('PhysicalCard'), 'One entry per physical copy.'),
      lists: arr(ref('ListRef'), 'Every list; only present when includeLists was set.'),
      warnings: arr(str(), 'List files that could not be fully read.'),
    },
    ['cards', 'warnings'],
  ),
  'PhysicalCard',
  'ListRef',
)

export const GET_CARD_DETAILS_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      ...CARD_SUMMARY_PROPS,
      layout: str(),
      colors: arr(str(), 'Mana colors (WUBRG letters); distinct from colorIdentity.'),
      keywords: arr(str()),
      legalities: {
        type: 'object',
        description: 'Scryfall format → status (legal/not_legal/banned/restricted).',
        additionalProperties: { type: 'string' },
      },
      oracleTags: arr(str()),
      artTags: arr(str()),
      faces: arr(ref('CardFaceSummary')),
      printingCount: int(),
      printingsComplete: bool(
        'False when the card cache holds no printing list for this name: printingCount is then ' +
          'just what one Scryfall lookup returned.',
      ),
    },
    [...PRINTING_IDENTITY_REQUIRED, 'prices', 'printingCount', 'printingsComplete'],
  ),
  'CardFaceSummary',
)

export const GET_CARD_PRINTINGS_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      name: str(),
      printings: arr(
        ref('PrintingListing'),
        'Newest first. `prices` is present only when includePrices was set.',
      ),
      totalPrintings: int(
        'Distinct set:collectorNumber printings found before limit truncated the list.',
      ),
      languages: arr(
        str(),
        'Every language the card’s full printing list exists in ("en" first), folding an ' +
          'absent lang to "en". ["en"] for any English-only (default-cards-backed) cache.',
      ),
      complete: bool(
        'False when the card cache holds no printing list for this name: the printings shown are ' +
          'whatever one Scryfall lookup returned, not the card’s full set.',
      ),
    },
    ['name', 'printings', 'languages', 'complete'],
  ),
  'PrintingListing',
)

export const GET_CARD_PRICE_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      name: str(),
      representative: nullable(ref('PrintingSummary')),
      lowestUsd: nullable(ref('PrintingSummary')),
      lowestEur: nullable(ref('PrintingSummary')),
      lowestTix: nullable(ref('PrintingSummary')),
    },
    ['name', 'representative', 'lowestUsd', 'lowestEur', 'lowestTix'],
  ),
  'PrintingSummary',
)

/**
 * What both price arms carry. Hoisted into a shared const, not out of the arms
 * into the union root: each arm has to stay complete on its own, because that
 * completeness is what lets a client discriminate on `mode` and then read the
 * arm without consulting the root. Spreading a const keeps the duplication in
 * the emitted JSON — where it belongs — and out of the authoring, where the two
 * verbatim copies of every description were the drift risk.
 */
const PRICE_REPORT_COMMON_PROPS = {
  currency: enumOf(VALID_CURRENCIES),
  source: enumOf(
    REPORT_PRICE_SOURCES,
    'Present when prices are Card Kingdom NM retail (source=cardkingdom) rather than Scryfall.',
  ),
  lastRefreshedAt: nullable(int(), 'Epoch ms of the last cache refresh.'),
  warnings: arr(str()),
} as const satisfies Properties

const PRICE_REPORT_COMMON_REQUIRED = ['mode', 'currency', 'lastRefreshedAt', 'warnings'] as const

export const GET_PRICE_REPORT_OUTPUT: JsonSchemaType = withDefs(
  {
    type: 'object',
    description: 'A price report, discriminated by `mode`.',
    oneOf: [
      obj(
        {
          mode: literal('summary'),
          ...PRICE_REPORT_COMMON_PROPS,
          lists: arr(ref('ListPriceSummary')),
          typeTotals: arr(ref('ListTypeTotals')),
          totals: ref('PriceReportTotals'),
        },
        [...PRICE_REPORT_COMMON_REQUIRED, 'lists', 'typeTotals', 'totals'],
      ),
      obj(
        {
          mode: literal('list'),
          ...PRICE_REPORT_COMMON_PROPS,
          list: ref('ListPriceSummary'),
          cards: arr(ref('PricedEntry'), 'Priced entries in file order.'),
        },
        [...PRICE_REPORT_COMMON_REQUIRED, 'cards'],
      ),
    ],
  },
  'ListPriceSummary',
  'ListTypeTotals',
  'PriceReportTotals',
  'PricedEntry',
)

// ── Sell report ───────────────────────────────────────────────────────

/** The quantity-weighted totals every sell summary carries. */
const SELL_TOTALS_PROPS = {
  cardCount: int('Copies considered.'),
  sellableCount: int('Copies CK will take (capped at their buy limits).'),
  totalValue: num('Sum of buy price × sellable copies (USD).'),
  notBuyingCount: int('Copies whose matched product CK is not currently buying.'),
  noMatchCount: int('Copies with no CK product match at all.'),
} as const satisfies Properties

const SELL_TOTALS_REQUIRED = [
  'cardCount',
  'sellableCount',
  'totalValue',
  'notBuyingCount',
  'noMatchCount',
] as const

const SELL_ENTRY_SCHEMA: JsonSchemaType = obj(
  {
    listType: LIST_TYPE,
    listName: str(),
    section: str(),
    name: str(),
    quantity: int('Copies the list holds (identical variants aggregated).'),
    set: str('Set code (lowercase): the entry’s pin, else the quoted printing’s.'),
    collectorNumber: str(),
    finish: FINISH,
    condition: CONDITION,
    pinned: bool('Whether set/collectorNumber came from the list entry itself.'),
    status: enumOf(SELL_ENTRY_STATUSES),
    noMatchReason: enumOf(SELL_NO_MATCH_REASONS),
    matchVia: enumOf(SELL_MATCH_VIAS, 'Which join key located the CK product.'),
    ambiguous: bool('Multiple CK products matched; the quote is from the best-paying one.'),
    ckProductId: int(),
    ckSku: str(),
    ckName: str('CK’s own card title (can differ from Scryfall’s).'),
    ckEdition: str('CK’s edition display name.'),
    ckVariation: str('CK’s variant note for the matched product, when they publish one.'),
    ckUrl: str('CK product page URL.'),
    ckFinish: enumOf(
      VALID_FINISHES,
      'The matched product’s finish — differs from finish on unpinned entries.',
    ),
    priceBuy: num('CK’s buylist cash quote per Near Mint copy (USD).'),
    priceRetail: num('CK’s retail price (USD), for reference.'),
    qtyBuying: int('Copies CK is currently buying of this product.'),
    sellableQuantity: int(
      'Copies CK would take, drawn from a per-product budget; 0 unless buying.',
    ),
    value: num('priceBuy × sellableQuantity.'),
    fileOrder: int(),
  },
  [
    'listType',
    'listName',
    'section',
    'name',
    'quantity',
    'pinned',
    'status',
    'sellableQuantity',
    'value',
    'fileOrder',
  ],
)

export const GET_SELL_REPORT_OUTPUT: JsonSchemaType = obj(
  {
    feedCreatedAt: str('Card Kingdom’s feed generation stamp, verbatim.'),
    feedRetrievedAt: int('Epoch ms when the feed was downloaded.'),
    filters: obj({
      sets: arr(str(), 'Set codes the entries were filtered to.'),
      minPrice: num('Minimum per-copy offer the entries were filtered to.'),
    }),
    lists: arr(
      obj({ type: LIST_TYPE, name: str(), ...SELL_TOTALS_PROPS }, [
        'type',
        'name',
        ...SELL_TOTALS_REQUIRED,
      ]),
    ),
    entries: arr(SELL_ENTRY_SCHEMA, 'Matched entries; filtered when filters are active.'),
    totals: obj({ ...SELL_TOTALS_PROPS, listCount: int() }, [...SELL_TOTALS_REQUIRED, 'listCount']),
    warnings: arr(str()),
  },
  ['feedCreatedAt', 'feedRetrievedAt', 'filters', 'lists', 'entries', 'totals', 'warnings'],
)

export const GET_SELL_CART_OUTPUT: JsonSchemaType = obj(
  {
    csv: str(
      'The sell-cart CSV — data rows only, no header row (CK’s importer prompts for column matching).',
    ),
    titleCount: int('Unique titles in the file (CK imports at most 500 per upload).'),
    cardCount: int('Total cards in the file (CK imports at most 5,000 per upload).'),
    warnings: arr(str(), 'Upload-cap overruns and etched foils the format cannot express.'),
  },
  ['csv', 'titleCount', 'cardCount', 'warnings'],
)

/** One buyer offer, as `/api/buylist/quotes` files it under a printing key. */
const BUYLIST_QUOTE_SCHEMA: JsonSchemaType = obj(
  {
    priceBuy: num('The buyer’s cash offer per copy (USD, Near Mint).'),
    qtyBuying: int('Copies the buyer is currently taking; 0 means paused despite a price.'),
    priceRetail: num(
      'The buyer’s own retail (sell-to-you) price per copy (USD, NM); 0 when unpublished.',
    ),
    qtyRetail: int(
      'Copies the buyer has in stock to sell; 0 means out of stock (the price stands).',
    ),
    buying: bool('Whether the buyer is actively buying (nonzero quantity and price).'),
    finish: enumOf(
      VALID_FINISHES,
      'The quoted product’s finish, which can differ from the requested one.',
    ),
    matchVia: enumOf(SELL_MATCH_VIAS, 'Which join key located the product.'),
    ambiguous: bool('Several products matched; this quote is the best-paying one.'),
    productId: int('The buyer’s product id, for pooling per-product buy budgets.'),
    name: str('The buyer’s own card title — what their cart importer expects.'),
    edition: str('The buyer’s own edition name — likewise.'),
    variation: str('The buyer’s variant note, when they publish one.'),
    url: str('The buyer’s product page.'),
  },
  [
    'priceBuy',
    'qtyBuying',
    'priceRetail',
    'qtyRetail',
    'buying',
    'finish',
    'matchVia',
    'productId',
    'name',
    'edition',
  ],
)

export const GET_BUYLIST_QUOTES_OUTPUT: JsonSchemaType = obj(
  {
    buyer: enumOf(BUYERS, 'The buyer these quotes came from.'),
    quotes: {
      type: 'object',
      description:
        'Offers keyed by "set:collectorNumber:finish" (set lowercased). Sparse: a ' +
        'requested printing the buyer has no product for is absent, meaning "not on ' +
        'the buylist".',
      additionalProperties: BUYLIST_QUOTE_SCHEMA,
    },
    feedCreatedAt: str('The buyer’s feed generation stamp, verbatim.'),
    feedRetrievedAt: int('Epoch ms when the feed was downloaded.'),
    stale: bool('Whether the cached feed is past its daily refresh cadence.'),
    productCount: int('Products in the cached feed.'),
  },
  ['buyer', 'quotes', 'feedCreatedAt', 'feedRetrievedAt', 'stale', 'productCount'],
)

export const GET_HISTORY_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      header: str('Everything before the first change set.'),
      sets: arr(ref('ChangeSet'), 'Change sets, newest first.'),
      defaultLines: arr(str(), 'Change lines describing the list’s current state.'),
    },
    ['header', 'sets', 'defaultLines'],
  ),
  'ChangeSet',
)

/** The stored configuration, which both config tools report identically. */
const EFFECTIVE_CONFIG: JsonSchemaType = openObject(
  'The effective Ritual configuration: ritual.config.json merged over the ' +
    'built-in defaults (the file is optional and may not exist yet).',
)

/** `update_config`: what was persisted, which is the stored config and nothing else. */
export const CONFIG_OUTPUT: JsonSchemaType = obj({ config: EFFECTIVE_CONFIG }, ['config'])

/**
 * `get_config`: the stored config plus what this *running* server has displaced
 * with a session flag. `update_config` deliberately does not carry the second
 * half — a write echoes back what it persisted, and an override is neither.
 */
export const GET_CONFIG_OUTPUT: JsonSchemaType = obj(
  {
    config: EFFECTIVE_CONFIG,
    overrides: {
      type: 'object',
      description:
        'What this running server operates with in place of the stored config, keyed by the ' +
        'config path each override displaces. Absent when the server follows the stored ' +
        'config in every respect.',
      // Tied to the engine's own override map, so a new session override key
      // is a compile error here rather than a silently undocumented field.
      properties: {
        'site.sellMode': bool(
          'Sell mode as this server actually answers it, because it was started with ' +
            '--sell-mode. config.site.sellMode still reports the stored value.',
        ),
      } satisfies Record<keyof SessionOverrides, JsonSchemaType>,
    },
  },
  ['config'],
)

export const GET_CACHE_STATUS_OUTPUT: JsonSchemaType = obj(
  {
    empty: bool('Whether the card cache holds no cards at all.'),
    cardCount: int('Distinct card names cached.'),
    lastCardRefresh: nullableStr('ISO-8601 time of the last bulk refresh.'),
    priceAgeHours: nullable(int(), 'Whole hours since the last bulk refresh.'),
    priceStale: bool('True when prices are older than 24h, or their age is unknown.'),
    tagsPresent: bool('Whether sampled cards carry Scryfall Tagger tags.'),
    source: enumOf(['local', 'cache-server']),
    defaultLanguage: enumOf(
      CARD_LANGUAGES,
      'The configured defaultLanguage — what decides which Scryfall bulk backs the cache.',
    ),
    cardBulkType: nullable(
      enumOf(CARD_BULK_TYPES),
      'Which bulk built the card cache (default_cards is English-only, all_cards every ' +
        'language); null when no ingest has recorded provenance.',
    ),
    bulkTypeStale: bool(
      'True when the cache’s bulk disagrees with what defaultLanguage demands — the cache ' +
        'needs a full refresh (refresh_cache).',
    ),
  },
  [
    'empty',
    'cardCount',
    'lastCardRefresh',
    'priceAgeHours',
    'priceStale',
    'tagsPresent',
    'source',
    'defaultLanguage',
    'cardBulkType',
    'bulkTypeStale',
  ],
)

export const DIFF_LISTS_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      a: ref('ListRef'),
      b: ref('ListRef'),
      by: enumOf(DIFF_BY_MODES),
      matches: arr(ref('DiffMatch'), 'Identities present on both sides.'),
      onlyInA: arr(ref('DiffOnly')),
      onlyInB: arr(ref('DiffOnly')),
      warnings: arr(str()),
    },
    ['a', 'b', 'by', 'matches', 'onlyInA', 'onlyInB', 'warnings'],
  ),
  'ListRef',
  'DiffMatch',
  'DiffOnly',
)

/** What both export arms carry; see the note on {@link PRICE_REPORT_COMMON_PROPS}. */
const EXPORT_COMMON_PROPS = {
  format: str(),
  entryCount: int(),
  warnings: arr(str()),
} as const satisfies Properties

const EXPORT_COMMON_REQUIRED = ['mode', 'format', 'entryCount', 'warnings'] as const

export const EXPORT_CARDS_OUTPUT: JsonSchemaType = {
  type: 'object',
  description: 'An export, discriminated by `mode`.',
  oneOf: [
    obj(
      {
        mode: literal('content'),
        ...EXPORT_COMMON_PROPS,
        content: str('The rendered export; nothing was written to disk.'),
      },
      [...EXPORT_COMMON_REQUIRED, 'content'],
    ),
    obj(
      {
        mode: literal('file'),
        ...EXPORT_COMMON_PROPS,
        path: str('Base-dir-relative path of the file written.'),
        bytes: int(),
      },
      [...EXPORT_COMMON_REQUIRED, 'path', 'bytes'],
    ),
  ],
}

/**
 * The message triple an admin-authored response carries.
 *
 * `message` is **always English** and always present — that is the contract
 * this catalogue has always had, and localizing it would change what an agent
 * reads. The other two are the same sentence unrendered, for a client that has
 * a translator (the admin UI); `messageKey` doubles as a locale-invariant
 * discriminator a script can match on instead of matching prose. Optional
 * because handlers gain keys incrementally.
 */
type MessageProperties = {
  message: JsonSchemaType
  messageKey: JsonSchemaType
  messageParams: JsonSchemaType
}

const MESSAGE_PROPS: MessageProperties = {
  message: str(),
  messageKey: str(
    'Catalog key the English `message` was rendered from — stable across locales, so a client may match on it instead of on prose. Absent when the text has no catalog entry.',
  ),
  messageParams: openObject('The parameters `messageKey` interpolates.'),
}

export const CREATE_LIST_OUTPUT: JsonSchemaType = obj(
  {
    ...MESSAGE_PROPS,
    slug: str('The new list’s slug — how every other tool addresses it.'),
  },
  ['message', 'slug'],
)

export const IMPORT_DECK_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    deckName: str('Name of the imported deck, which is also its slug.'),
    warnings: arr(
      str(),
      'Text-import lines the parser skipped — content that was NOT imported. Empty for URL imports.',
    ),
    advisories: arr(
      str(),
      'Non-fatal notices about text that WAS read (e.g. a card name still carrying a printing token, or an empty Maybeboard/Tokens section the write drops). Empty for URL imports.',
    ),
    syncPrintings: bool(
      'Whether the written deck kept the exact printings the source listed. Always true for a text import, whose printings are the pasted lines’ own.',
    ),
  },
  ['message', 'deckName', 'warnings', 'advisories', 'syncPrintings'],
)

export const IMPORT_CSV_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      message: str(),
      cardCount: int(
        'Copies imported (sum of row quantities); 0 when every row failed validation.',
      ),
      failures: arr(ref('CsvRowFailure'), 'Rows that failed validation; the rest still imported.'),
      failedCount: int('failures.length, so a client can branch without walking the array.'),
      warnings: arr(
        str(),
        'Whole-import notices, not per-row ones: what hasHeader caused (the header row that was skipped, and whether it actually looked like a header).',
      ),
    },
    ['message', 'cardCount', 'failures', 'failedCount', 'warnings'],
  ),
  'CsvRowFailure',
)

export const IMPORT_CHANGE_BUNDLE_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      message: str(),
      lists: arr(ref('ListImportResult')),
      failedCount: int(
        'Lists with an `error` (could not be resolved, loaded, or saved); the other lists still applied.',
      ),
    },
    ['message', 'lists', 'failedCount'],
  ),
  'ListImportResult',
)

export const SET_LIST_METADATA_OUTPUT: JsonSchemaType = obj(
  {
    slug: str(),
    // Enumerated rather than left an open object: these are exactly the keys
    // this tool writes, so an agent reading the echo back should see them named.
    // Still open (no `additionalProperties: false`) because a deck file's front
    // matter round-trips any other key its owner put there.
    frontMatter: {
      type: 'object',
      description: 'The list’s whole front matter after the write, unknown keys included.',
      properties: {
        format: enumOf(DECK_FORMAT_KEYS, 'Canonical deck-format key.'),
        tags: arr(str()),
        description: str(),
        sourceId: str('The deck’s id on the source service.'),
        sourceUrl: str('The deck’s URL on the source service.'),
        lastSynced: str('ISO-8601 time of the last successful source sync.'),
        labels: arr(CARD_LABEL, 'The list’s default card labels (decks carry "proxy" alone).'),
        image: LIST_IMAGE_REF,
      },
    },
  },
  ['slug', 'frontMatter'],
)

export const SET_CARD_ART_OUTPUT: JsonSchemaType = obj(
  {
    ...MESSAGE_PROPS,
    slug: str(),
    cardId: int('The card line’s &N id the art was filed under.'),
    // Required, and `null` is a value rather than an absence: the write echoes
    // back what the card now carries, and a cleared card carries nothing.
    art: nullable(
      CARD_ART_REF,
      'The reference now stored for the card, or null when it was cleared.',
    ),
  },
  ['message', 'slug', 'cardId', 'art'],
)

export const MUTATION_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      applied: int('Changes applied; equal to the batch size, since edits are all-or-nothing.'),
      ...MESSAGE_PROPS,
      listType: LIST_TYPE,
      slug: str(),
      effects: arr(
        ref('SaveEffect'),
        'What the save did to individual entries, with the &N ids it allocated.',
      ),
      unmatched: arr(str(), 'Always empty on a returning call; a miss fails the whole batch.'),
      artWarnings: arr(
        str(),
        'Custom-art sidecars this save could not re-file — its own, or a move destination’s. ' +
          'The card lines were written; only the art re-filing did not happen. ' +
          'Absent when every reconcile was clean.',
      ),
    },
    ['applied', 'message', 'listType', 'slug', 'effects', 'unmatched'],
  ),
  'SaveEffect',
)

export const MOVE_SELECTED_CARDS_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      moved: int(),
      requested: int(),
      skipped: int('Moves whose card or destination could not be resolved.'),
      droppedNotes: arr(ref('DroppedNote'), 'Notes the destination could not keep.'),
      warnings: arr(str(), 'List files that could not be fully read.'),
      ...MESSAGE_PROPS,
    },
    ['moved', 'requested', 'skipped', 'droppedNotes', 'warnings', 'message'],
  ),
  'DroppedNote',
)

export const REMOVE_SELECTED_CARDS_OUTPUT: JsonSchemaType = obj(
  {
    removed: int(),
    requested: int(),
    skipped: int('Items whose card could not be resolved.'),
    warnings: arr(str(), 'List files that could not be fully read.'),
    ...MESSAGE_PROPS,
  },
  ['removed', 'requested', 'skipped', 'warnings', 'message'],
)

export const RENAME_LIST_OUTPUT: JsonSchemaType = obj(
  {
    ...MESSAGE_PROPS,
    newSlug: str('Address the list by this from now on.'),
    newFilePath: str('The list’s file path after the rename.'),
    oldFilePath: str('The path it occupied before the rename.'),
  },
  ['message', 'newSlug', 'newFilePath', 'oldFilePath'],
)

export const DELETE_LIST_OUTPUT: JsonSchemaType = obj(
  {
    ...MESSAGE_PROPS,
    deletedFiles: arr(str(), 'Every file removed: the list plus whichever sidecars it had.'),
  },
  ['message', 'deletedFiles'],
)

export const REWRITE_HISTORY_OUTPUT: JsonSchemaType = obj(
  { ...MESSAGE_PROPS, setCount: int('Change sets written.') },
  ['message', 'setCount'],
)

export const BUILD_SITE_OUTPUT: JsonSchemaType = obj(
  {
    ...MESSAGE_PROPS,
    outDir: str('Directory the built site was published to.'),
    durationMs: int('Wall-clock build time, in milliseconds.'),
  },
  ['message', 'outDir', 'durationMs'],
)

/**
 * A bare `{ message }` result keeps its own declaration rather than sharing one
 * with the other tools that happen to answer the same way today. Unrelated
 * operations' responses are free to grow independently — not a hypothetical:
 * `build_site` and `delete_list` both started here and grew fields of their own,
 * and a shared const would have made each of those a change to every member.
 * Exactly the coupling `$defs` reuse should never introduce.
 */
export const REFRESH_CACHE_OUTPUT: JsonSchemaType = obj({ ...MESSAGE_PROPS }, ['message'])

export const REFRESH_BUYLIST_OUTPUT: JsonSchemaType = obj(
  {
    refreshed: bool(
      'Whether a new feed was downloaded. False with empty warnings: the cache was still ' +
        'fresh; false with a warning: the download failed and the stale cache is in use.',
    ),
    feedRetrievedAt: int('Epoch ms of the feed download.'),
    feedCreatedAt: str('Card Kingdom’s feed generation stamp, verbatim.'),
    productCount: int('Products in the feed.'),
    warnings: arr(str(), 'Failures that degraded the result (stale-feed fallback).'),
  },
  ['refreshed', 'feedRetrievedAt', 'feedCreatedAt', 'productCount', 'warnings'],
)

/**
 * A run summary as its clauses, beside the English sentence `message` already
 * carries. The clause list is what lets a client join and pluralize a summary
 * in its own language rather than re-parsing English prose.
 */
const SYNC_SUMMARY: JsonSchemaType = obj(
  {
    clauses: arr(
      obj(MESSAGE_PROPS, ['message']),
      'The summary’s clauses in reading order, each an English sentence fragment plus the catalog key it came from. Joined with a locale-appropriate separator and terminated by the renderer, so no clause carries final punctuation.',
    ),
  },
  ['clauses'],
)

const SYNC_DIRECTION = enumOf(['pull', 'push'])

export const SYNC_DECKS_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    summary: SYNC_SUMMARY,
    report: obj(
      {
        direction: SYNC_DIRECTION,
        decks: arr(openObject('One deck’s sync outcome.')),
        failedCount: int('Decks that failed; a run with failures still reports success.'),
        unreadable: arr(openObject('A deck file holding lines the parser cannot read.')),
      },
      ['direction', 'decks', 'failedCount', 'unreadable'],
    ),
  },
  ['message', 'summary', 'report'],
)

export const SYNC_COLLECTION_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    summary: SYNC_SUMMARY,
    report: obj(
      {
        direction: SYNC_DIRECTION,
        into: nullableStr('The list a pull added new cards to; null on a push.'),
        dryRun: bool(),
        lists: arr(openObject('One collection list’s sync outcome.')),
        failedCount: int('Lists that failed; a run with failures still reports success.'),
        errors: arr(str(), 'Run-level failures, as opposed to per-list ones.'),
        unreadable: arr(openObject('A list file holding lines the parser cannot read.')),
        ambiguous: arr(openObject('A partial removal spanning several lists.')),
        localIncomplete: bool('True when some in-scope list did not make it into the comparison.'),
        csv: nullable(openObject('What the CSV bulk-import path did with a push’s additions.')),
        // Enumerated, unlike the per-list outcomes above: this is the field a
        // caller is told to read to find out what a run actually did, so leaving
        // its four counts unnamed would defeat the instruction.
        totals: obj(
          {
            added: int('Copies added (locally on a pull, remotely on a push).'),
            removed: int('Copies removed.'),
            skipped: int('Copies the run could not apply.'),
            pending: int('Copies written to a --csv-file rather than pushed (CLI only).'),
          },
          ['added', 'removed', 'skipped', 'pending'],
        ),
      },
      [
        'direction',
        'into',
        'dryRun',
        'lists',
        'failedCount',
        'errors',
        'unreadable',
        'ambiguous',
        'localIncomplete',
        'csv',
        'totals',
      ],
    ),
  },
  ['message', 'summary', 'report'],
)

/**
 * The failure payload every tool returns on an `isError` result.
 *
 * Documented and pinned, but deliberately **not** an arm of any tool's
 * `outputSchema`: the SDK skips output validation entirely for `isError`
 * results, so an error arm would buy zero runtime checking while adding a second
 * shape a client must discriminate on every successful read, on every tool in
 * the catalogue.
 */
export const TOOL_ERROR_OUTPUT: JsonSchemaType = obj(
  {
    error: { type: 'boolean', const: true },
    code: enumOf(['conflict', 'invalid-request', 'internal']),
    message: str(),
    conflict: {
      type: 'boolean',
      const: true,
      description: 'Only on code "conflict": a lost optimistic-concurrency race.',
    },
    recovery: str('The next action, when there is a concrete one.'),
    unmatched: arr(str(), 'Changes that did not apply, when a batch was rejected whole.'),
  },
  ['error', 'code', 'message'],
)

/**
 * Tool name → its advertised output schema.
 *
 * Keyed by the tool-name union rather than by `string`, so a tool added to
 * `MCP_TOOL_NAMES` without a schema (or a schema left behind by a rename) is a
 * compile error here instead of a runtime gap the catalogue test finds later.
 */
export const TOOL_OUTPUT_SCHEMAS: Readonly<Record<McpToolName, JsonSchemaType>> = {
  list_lists: LIST_LISTS_OUTPUT,
  get_sync_status: GET_SYNC_STATUS_OUTPUT,
  get_list: GET_LIST_OUTPUT,
  search_scryfall: SEARCH_SCRYFALL_OUTPUT,
  autocomplete_card: AUTOCOMPLETE_CARD_OUTPUT,
  find_cards: FIND_CARDS_OUTPUT,
  get_card_details: GET_CARD_DETAILS_OUTPUT,
  get_card_printings: GET_CARD_PRINTINGS_OUTPUT,
  get_card_price: GET_CARD_PRICE_OUTPUT,
  get_price_report: GET_PRICE_REPORT_OUTPUT,
  get_sell_report: GET_SELL_REPORT_OUTPUT,
  get_sell_cart: GET_SELL_CART_OUTPUT,
  get_buylist_quotes: GET_BUYLIST_QUOTES_OUTPUT,
  get_history: GET_HISTORY_OUTPUT,
  get_config: GET_CONFIG_OUTPUT,
  get_cache_status: GET_CACHE_STATUS_OUTPUT,
  diff_lists: DIFF_LISTS_OUTPUT,
  export_cards: EXPORT_CARDS_OUTPUT,
  create_list: CREATE_LIST_OUTPUT,
  import_deck: IMPORT_DECK_OUTPUT,
  import_csv: IMPORT_CSV_OUTPUT,
  import_change_bundle: IMPORT_CHANGE_BUNDLE_OUTPUT,
  set_list_metadata: SET_LIST_METADATA_OUTPUT,
  add_card: MUTATION_OUTPUT,
  remove_card: MUTATION_OUTPUT,
  set_card_printing: MUTATION_OUTPUT,
  set_card_art: SET_CARD_ART_OUTPUT,
  apply_changes: MUTATION_OUTPUT,
  move_selected_cards: MOVE_SELECTED_CARDS_OUTPUT,
  remove_selected_cards: REMOVE_SELECTED_CARDS_OUTPUT,
  rename_list: RENAME_LIST_OUTPUT,
  delete_list: DELETE_LIST_OUTPUT,
  rewrite_history: REWRITE_HISTORY_OUTPUT,
  update_config: CONFIG_OUTPUT,
  build_site: BUILD_SITE_OUTPUT,
  sync_decks: SYNC_DECKS_OUTPUT,
  sync_collection: SYNC_COLLECTION_OUTPUT,
  refresh_cache: REFRESH_CACHE_OUTPUT,
  refresh_buylist: REFRESH_BUYLIST_OUTPUT,
}
