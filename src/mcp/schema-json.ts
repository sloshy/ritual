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
import {
  SELL_ENTRY_STATUSES,
  SELL_NO_MATCH_REASONS,
  type SellEntryBase,
  type SellEntryMatch,
} from '../pricing/sell-report'
import { VALID_PRICE_SOURCES } from '../pricing/price-source'
import { EXPORT_FORMATS } from '../export/presets'
import {
  SYNC_DIRECTIONS,
  SYNC_ITEM_OUTCOMES,
  SYNC_ITEM_STATUSES,
  type UnreadableSource,
} from '../sync/common'
import type { SyncMessage, SyncReasonFields } from '../sync/message'
import type { ImportParseWarning } from '../importers/text-file'
import { BOARDS } from '../list/deck'
import type {
  CollectionSyncCardAdded,
  CollectionSyncCardChange,
  CollectionSyncCopies,
  CollectionSyncListResult,
  CollectionSyncPrinting,
  CollectionSyncReport,
  CollectionSyncTotals,
} from '../collection-sync/types'
import type {
  DeckSyncCardAdded,
  DeckSyncCardCategories,
  DeckSyncCardMove,
  DeckSyncCardPrinting,
  DeckSyncCardQuantity,
  DeckSyncCardRemoved,
  DeckSyncDeckResult,
  DeckSyncPrinting,
  DeckSyncReport,
} from '../deck-sync/types'
import { TOOL_ERROR_CODES } from './error-codes'
import type { SessionOverrides } from '../config/ritual-config'
import type { SellRefreshResponse } from '../admin/api/sell'
import {
  CARD_ART_REF,
  CARD_LABEL,
  CARD_SUMMARY_PROPS,
  CONDITION,
  CUSTOM_ART_MAP,
  FINISH,
  LIST_CATEGORIES,
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

// ── Message shapes ────────────────────────────────────────────────────

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

/**
 * The message triple of a response whose params may nest — a sync message
 * (`src/sync/message.ts`): an import summary built from counted nouns, a refusal
 * naming ambiguous lists. Checked against the engine type.
 */
const SYNC_MESSAGE_PROPS = {
  message: str(),
  messageKey: MESSAGE_PROPS.messageKey,
  messageParams: openObject(
    'What `messageKey` interpolates; a param may itself be a message (`messageKey`, ' +
      '`messageParams`), a list (`list`, `join`), a duration (`elapsedMs`, or `durationMs` for ' +
      'an age or a time-out) or a card language (`language`).',
  ),
} as const satisfies Record<keyof SyncMessage, JsonSchemaType>

/** One message on its own — a run-level sync failure, an import warning: English plus key and params. */
const SYNC_MESSAGE: JsonSchemaType = obj(SYNC_MESSAGE_PROPS, ['message'])

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

/**
 * A file a sync refused to rewrite because its parser could not read some of
 * it: its name, its file and one message per line a rewrite would delete.
 */
const UNREADABLE_SOURCE: JsonSchemaType = obj(
  {
    name: str('The deck’s or list’s display name.'),
    file: str('The file’s basename.'),
    warnings: arr(SYNC_MESSAGE, 'One message per line a rewrite would delete.'),
  } as const satisfies Record<keyof UnreadableSource, JsonSchemaType>,
  ['name', 'file', 'warnings'],
)

/** What every `get_list` arm carries besides its two discriminants. */
const GET_LIST_COMMON_PROPS = {
  slug: str(),
  warnings: arr(
    SYNC_MESSAGE,
    'What a whole-file save cannot write back as it is: lines the parser could not read, fenced code blocks, and held deck lines (`- 1234 Sol Ring`, read as one card but possibly 1,234 copies written without the x). Always present, empty when the file is clean. A write refuses a list that has any; only the user can settle them by editing the file (`1234x Sol Ring` or `- 1 1234 Sol Ring`). Each is a message: English `message`, plus `messageKey`/`messageParams`.',
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
  categories: LIST_CATEGORIES,
  categoryWarnings: arr(
    str(),
    'Problems with the list’s categories sidecar (unreadable, or categories for cards that are ' +
      'gone). Separate from warnings: these never block a mutation. Absent when the sidecar is ' +
      'clean.',
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
            'The deck’s default card labels from front matter ("proxy" alone); a card’s own labels adjust them.',
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
            'The list’s default card labels from front matter (never on a wanted list); a card’s own labels adjust them.',
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
  source: enumOf(VALID_PRICE_SOURCES, 'The store every price comes from.'),
  currency: enumOf(VALID_CURRENCIES, 'The store’s one currency.'),
  lastRefreshedAt: nullable(int(), 'Epoch ms of the last cache refresh.'),
  warnings: arr(str()),
} as const satisfies Properties

const PRICE_REPORT_COMMON_REQUIRED = [
  'mode',
  'source',
  'currency',
  'lastRefreshedAt',
  'warnings',
] as const

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

/** Every key a sell entry can carry, across its status arms — the schema must name each. */
type SellEntryKey = keyof SellEntryBase | keyof SellEntryMatch | 'status' | 'noMatchReason'

/**
 * The entry properties, checked against the engine's entry type: a field added
 * to `SellEntryBase` or `SellEntryMatch` is a compile error here until the
 * schema describes it.
 */
const SELL_ENTRY_PROPS = {
  listType: LIST_TYPE,
  listName: str(),
  section: str(),
  name: str(),
  quantity: int('Copies the list holds (identical variants aggregated).'),
  set: str('Set code (lowercase): the entry’s pin, else the quoted printing’s.'),
  collectorNumber: str(),
  finish: FINISH,
  condition: CONDITION,
  language: enumOf(
    CARD_LANGUAGES,
    'The lines’ language token; absent means English. A non-English entry is never quoted ' +
      '(noMatchReason "non-english").',
  ),
  pinned: bool('Whether set/collectorNumber came from the list entry itself.'),
  cardIds: arr(
    int(),
    'The &N ids of the list lines behind this entry, in file order (one per line; lines ' +
      'without an id yet contribute none). Pass them to set-card/move/remove-card tools.',
  ),
  tags: arr(str(), 'The lines’ tags, canonical.'),
  edhrecRank: int(
    'The card’s EDHREC rank (lower is more popular); absent when unranked or uncached.',
  ),
  // Copies of this card, by name, held in all your lists — not just the report's scope.
  ownedCopies: obj(
    {
      collection: int(
        'Real copies of the card, by name, across every collection (any printing; proxies ' +
          'excluded), whatever the report’s scope.',
      ),
      deck: int('Copies across every deck (any printing; extras sections and proxies excluded).'),
    },
    ['collection', 'deck'],
  ),
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
  tcgplayerPrice: num(
    'The quoted printing’s TCGplayer market price (USD) at the quoted finish, from the card ' +
      'cache; absent when uncached or unpriced.',
  ),
  offerRatio: num(
    'priceBuy ÷ tcgplayerPrice, three decimals (0.8 = CK pays 80% of market); present exactly ' +
      'when tcgplayerPrice is.',
  ),
  sellableQuantity: int('Copies CK would take, drawn from a per-product budget; 0 unless buying.'),
  value: num('priceBuy × sellableQuantity.'),
  fileOrder: int(),
} as const satisfies Record<SellEntryKey, JsonSchemaType>

const SELL_ENTRY_SCHEMA: JsonSchemaType = obj(SELL_ENTRY_PROPS, [
  'listType',
  'listName',
  'section',
  'name',
  'quantity',
  'pinned',
  'cardIds',
  'ownedCopies',
  'status',
  'sellableQuantity',
  'value',
  'fileOrder',
])

export const GET_SELL_REPORT_OUTPUT: JsonSchemaType = obj(
  {
    feedCreatedAt: str('Card Kingdom’s feed generation stamp, verbatim.'),
    feedRetrievedAt: int('Epoch ms when the feed was downloaded.'),
    filters: obj({
      tags: arr(str(), 'Tags the report was scoped to (lines carrying any of them).'),
      sets: arr(str(), 'Set codes the entries were filtered to.'),
      minPrice: num('Minimum per-copy offer the entries were filtered to.'),
      minRatio: num('Minimum offer-to-market ratio the entries were filtered to.'),
      minOwned: int('Minimum total owned copies the entries were filtered to.'),
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
      defaultEvents: arr(
        ref('ChangeEvent'),
        'Events describing the list’s current state, for a rewrite-with-defaults.',
      ),
      categoryWarnings: arr(
        str(),
        'Why defaultEvents names no categories: the list’s categories sidecar could not be read. ' +
          'Absent when there was nothing to say.',
      ),
    },
    ['header', 'sets', 'defaultEvents'],
  ),
  'ChangeSet',
  'ChangeEvent',
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
      warnings: arr(
        SYNC_MESSAGE,
        "Both lists' parse warnings, each naming its list (domain.export.warning.inList, the parser's own message nested as `warning`).",
      ),
    },
    ['a', 'b', 'by', 'matches', 'onlyInA', 'onlyInB', 'warnings'],
  ),
  'ListRef',
  'DiffMatch',
  'DiffOnly',
)

/** What both export arms carry; see the note on {@link PRICE_REPORT_COMMON_PROPS}. */
const EXPORT_COMMON_PROPS = {
  format: enumOf(EXPORT_FORMATS),
  entryCount: int(),
  warnings: arr(
    SYNC_MESSAGE,
    'What the export reports beside its output (domain.export.warning.*): unreadable list lines, unmatched card terms, cells the local card cache could not fill, cards or categories a decklist dialect left out.',
  ),
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

export const CREATE_LIST_OUTPUT: JsonSchemaType = obj(
  {
    ...MESSAGE_PROPS,
    slug: str('The new list’s slug — how every other tool addresses it.'),
  },
  ['message', 'slug'],
)

export const IMPORT_DECK_OUTPUT: JsonSchemaType = obj(
  {
    ...SYNC_MESSAGE_PROPS,
    deckName: str('Name of the imported deck, which is also its slug.'),
    warnings: arr(
      obj(
        {
          ...SYNC_MESSAGE_PROPS,
          labelsDropped: {
            type: 'boolean',
            const: true,
            description:
              'Present (always true) when the line WAS imported, only without the labels it carried; absent when the line was skipped.',
          },
        } as const satisfies Record<keyof ImportParseWarning, JsonSchemaType>,
        ['message'],
      ),
      'Text-import lines the parser skipped — content that was NOT imported — or kept without their labels (`labelsDropped`). Empty for URL imports. Each is a message: English `message`, plus `messageKey`/`messageParams` when it has a catalog entry.',
    ),
    advisories: arr(
      SYNC_MESSAGE,
      'Non-fatal notices about content that WAS imported: for text, e.g. a card name still carrying a printing token, or an empty Maybeboard/Tokens section the write drops; for a URL import, source category names Ritual refused or a categories file that could not be written. Messages, like `warnings`.',
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
      ...SYNC_MESSAGE_PROPS,
      cardCount: int(
        'Copies imported (sum of row quantities); 0 when every row failed validation.',
      ),
      failures: arr(ref('CsvRowFailure'), 'Rows that failed validation; the rest still imported.'),
      failedCount: int('failures.length, so a client can branch without walking the array.'),
      warnings: arr(
        SYNC_MESSAGE,
        "Import-level notices, not per-row validation failures (those are in failures): what hasHeader caused (the header row that was skipped, and whether it actually looked like a header), category values a row's categories cell refused (the row still imported), and anything that went wrong writing the list's categories sidecar. Each is a message: English `message`, plus `messageKey`/`messageParams` when it has a catalog entry.",
      ),
    },
    ['message', 'cardCount', 'failures', 'failedCount', 'warnings'],
  ),
  'CsvRowFailure',
)

export const IMPORT_CHANGE_BUNDLE_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      ...SYNC_MESSAGE_PROPS,
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

/**
 * Card names whose category assignments a write dropped. One wording for the
 * three schemas that report it, since one handler channel feeds them all.
 */
const PRUNED_CATEGORIES = arr(
  str(),
  'Card names whose category assignments were dropped because the list no longer holds a line ' +
    'of that name. Absent when nothing was pruned.',
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
      categoryWarnings: arr(
        str(),
        'Categories sidecars this save could not read or write. The card lines were written; ' +
          'only the sidecar did not change. Absent when clean.',
      ),
      prunedCategories: PRUNED_CATEGORIES,
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
      prunedCategories: PRUNED_CATEGORIES,
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
    prunedCategories: PRUNED_CATEGORIES,
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
    trashDir: str(
      'Absolute path of the trash folder the files were moved into. Inside it each file keeps its workspace-relative path (one outside the workspace just its name); moving them back restores the list.',
    ),
  },
  ['message', 'deletedFiles', 'trashDir'],
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

/** `refresh_buylist`'s fields, checked against the route body it returns. */
const REFRESH_BUYLIST_PROPS = {
  refreshed: bool(
    'Whether a new feed was downloaded. False without staleFallback: the cache was still ' +
      'fresh; false with staleFallback: the download failed and the stale cache is in use.',
  ),
  feedRetrievedAt: int('Epoch ms of the feed download.'),
  feedCreatedAt: str('Card Kingdom’s feed generation stamp, verbatim.'),
  productCount: int('Products in the feed.'),
  staleFallback: {
    ...SYNC_MESSAGE,
    description:
      'Present only when a download failed and the stale cached feed is in use: the failure, ' +
      'as English `message` plus its `messageKey`/`messageParams`.',
  },
  skippedRows: arr(
    SYNC_MESSAGE,
    'Product rows of the downloaded feed skipped as malformed, each a message (English ' +
      '`message` plus `messageKey`/`messageParams`; the row reason nests as `reason`). The first ' +
      'ten are itemized, then one message counts the rest. Empty when nothing was downloaded.',
  ),
} as const satisfies Record<keyof Omit<SellRefreshResponse, 'success'>, JsonSchemaType>

export const REFRESH_BUYLIST_OUTPUT: JsonSchemaType = obj(REFRESH_BUYLIST_PROPS, [
  'refreshed',
  'feedRetrievedAt',
  'feedCreatedAt',
  'productCount',
  'skippedRows',
])

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

const SYNC_DIRECTION = enumOf(SYNC_DIRECTIONS)

const SYNC_ITEM_STATUS = enumOf(SYNC_ITEM_STATUSES)

/**
 * What came of one synced item, as a fixed code — the field to branch on,
 * rather than the prose in `reason`.
 */
const SYNC_ITEM_OUTCOME = enumOf(
  SYNC_ITEM_OUTCOMES,
  'What came of the item: "changed" (written or sent — for a collection push with a CSV ' +
    'file, written there for upload), "unchanged" (already matched, or nothing to send), ' +
    '"dry-run" (a preview; `reason` summarizes it), "cancelled" (the call was cancelled ' +
    'before reaching it) or "not-run" (the run refused before reaching it; its error says ' +
    'why). Tied to `status`: always present on a synced item, and then never "cancelled" ' +
    'or "not-run"; on a skipped item only ever "cancelled" or "not-run" (absent for any ' +
    'other skip); never on a failed item. Branch on this, never on `reason` text.',
)

/**
 * The reason fields every per-item sync result carries: English `reason`, plus
 * the key and params it was rendered from — `messageKey` / `messageParams`
 * under the names of the field they belong to. Keyed by the engine type, so a
 * renamed field is a compile error here.
 */
type SyncReasonProperties = Record<keyof SyncReasonFields, JsonSchemaType>

function syncReasonProps(reason: string): SyncReasonProperties {
  return {
    reason: str(`${reason} English prose; never match on it — read \`outcome\`.`),
    reasonKey: str(
      'Catalog key `reason` was rendered from, for a client that renders it in its own ' +
        'language. Absent when the reason is an error raised outside the catalog.',
    ),
    reasonParams: openObject(
      'What `reasonKey` interpolates. A param may itself be a message (`messageKey`, ' +
        '`messageParams`), a list (`list`, `join`), a duration (`elapsedMs`, or `durationMs` ' +
        'for an age or a time-out) or a card language (`language`).',
    ),
  }
}

const DECK_BOARD = enumOf(BOARDS)

/** A printing a deck-sync card change is about; every field absent on a bare line. */
const DECK_SYNC_PRINTING: JsonSchemaType = obj({
  set: str('Lowercase set code.'),
  collectorNumber: str(),
  finish: { ...FINISH, description: 'Absent means nonfoil.' },
} as const satisfies Record<keyof DeckSyncPrinting, JsonSchemaType>)

/** The optional `printing` the copy-count entries carry on a printing-keyed diff. */
const DECK_SYNC_CHANGE_PRINTING: JsonSchemaType = {
  ...DECK_SYNC_PRINTING,
  description: 'The printing the copies carry; present only on a run syncing printings.',
}

/*
 * One property map per `DeckSyncCardChange` arm, each checked against its
 * engine type: a field added to an arm without a schema here is a compile error.
 */

const DECK_SYNC_ADDED_PROPS = {
  kind: literal('added'),
  name: str(),
  quantity: int(),
  board: DECK_BOARD,
  printing: DECK_SYNC_CHANGE_PRINTING,
} as const satisfies Record<keyof DeckSyncCardAdded, JsonSchemaType>

const DECK_SYNC_REMOVED_PROPS = {
  kind: literal('removed'),
  name: str(),
  quantity: int(),
  board: DECK_BOARD,
  printing: DECK_SYNC_CHANGE_PRINTING,
} as const satisfies Record<keyof DeckSyncCardRemoved, JsonSchemaType>

const DECK_SYNC_QUANTITY_PROPS = {
  kind: literal('quantity'),
  name: str(),
  board: DECK_BOARD,
  from: int('Copies before.'),
  to: int('Copies after.'),
  printing: DECK_SYNC_CHANGE_PRINTING,
} as const satisfies Record<keyof DeckSyncCardQuantity, JsonSchemaType>

const DECK_SYNC_MOVE_PROPS = {
  kind: literal('move'),
  name: str(),
  quantity: int('Copies moving; a move adds and removes none.'),
  from: DECK_BOARD,
  to: DECK_BOARD,
  printing: DECK_SYNC_CHANGE_PRINTING,
} as const satisfies Record<keyof DeckSyncCardMove, JsonSchemaType>

const DECK_SYNC_PRINTING_PROPS = {
  kind: literal('printing'),
  name: str(),
  board: DECK_BOARD,
  from: DECK_SYNC_PRINTING,
  to: { ...DECK_SYNC_PRINTING, description: 'The printing the copies end up holding.' },
} as const satisfies Record<keyof DeckSyncCardPrinting, JsonSchemaType>

const DECK_SYNC_CATEGORIES_PROPS = {
  kind: literal('categories'),
  name: str(),
  categories: arr(str(), 'The card’s categories, primary first; empty clears them.'),
} as const satisfies Record<keyof DeckSyncCardCategories, JsonSchemaType>

/** One `DeckSyncCardChange`, discriminated by `kind`. */
const DECK_SYNC_CARD_CHANGE: JsonSchemaType = {
  type: 'object',
  description: 'One card change, by `kind`.',
  oneOf: [
    obj(DECK_SYNC_ADDED_PROPS, ['kind', 'name', 'quantity', 'board']),
    obj(DECK_SYNC_REMOVED_PROPS, ['kind', 'name', 'quantity', 'board']),
    obj(DECK_SYNC_QUANTITY_PROPS, ['kind', 'name', 'board', 'from', 'to']),
    obj(DECK_SYNC_MOVE_PROPS, ['kind', 'name', 'quantity', 'from', 'to']),
    obj(DECK_SYNC_PRINTING_PROPS, ['kind', 'name', 'board', 'from', 'to']),
    obj(DECK_SYNC_CATEGORIES_PROPS, ['kind', 'name', 'categories']),
  ],
}

/** One deck's `DeckSyncDeckResult`, checked against the engine type. */
const DECK_SYNC_DECK_RESULT_PROPS = {
  name: str(),
  status: SYNC_ITEM_STATUS,
  outcome: SYNC_ITEM_OUTCOME,
  ...syncReasonProps('Why the deck did not cleanly sync, or a dry run’s summary.'),
  printingsChanged: int('Printing differences found; only on a run syncing printings.'),
  printingsUnaligned: arr(str(), 'Cards whose printings disagree and were left alone.'),
  boardMoves: int('Board moves found; present only when there is one.'),
  categoriesChanged: int('Cards whose categories changed; only on a run syncing categories.'),
  changes: arr(
    DECK_SYNC_CARD_CHANGE,
    'Every card change the run applied (or would have, on a dry run), narrowed by `only`, ' +
      'in summary order: added, removed, quantity, move, printing, categories. Lists what ' +
      'went through; when the push itself failed (nothing was sent), what it attempted — ' +
      '`reason` says so. ' +
      'Present only when there is at least one.',
  ),
} as const satisfies Record<keyof DeckSyncDeckResult, JsonSchemaType>

const DECK_SYNC_DECK_RESULT: JsonSchemaType = obj(DECK_SYNC_DECK_RESULT_PROPS, ['name', 'status'])

/** The deck-sync report, checked against the engine type. */
const DECK_SYNC_REPORT_PROPS = {
  direction: SYNC_DIRECTION,
  decks: arr(DECK_SYNC_DECK_RESULT, 'One sync outcome per deck the run covered.'),
  failedCount: int('Decks that failed; a run with failures still reports success.'),
  unreadable: arr(UNREADABLE_SOURCE, 'Deck files holding lines the parser cannot read.'),
  cancelled: bool(
    'True when the call was cancelled between decks; the decks never started are skipped.',
  ),
} as const satisfies Record<keyof DeckSyncReport, JsonSchemaType>

export const SYNC_DECKS_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    summary: SYNC_SUMMARY,
    report: obj(DECK_SYNC_REPORT_PROPS, [
      'direction',
      'decks',
      'failedCount',
      'unreadable',
      'cancelled',
    ]),
  },
  ['message', 'summary', 'report'],
)

/** The printing a collection-sync card change is about. */
const COLLECTION_SYNC_PRINTING: JsonSchemaType = obj(
  {
    set: str('Lowercase set code.'),
    collectorNumber: str(),
    finish: FINISH,
    condition: CONDITION,
    language: enumOf(CARD_LANGUAGES, 'Absent for English.'),
  } as const satisfies Record<keyof CollectionSyncPrinting, JsonSchemaType>,
  ['set', 'collectorNumber', 'finish', 'condition'],
)

/** The property map every `CollectionSyncCopies` arm shares, checked against the type. */
function collectionCopiesProps<K extends CollectionSyncCardChange['kind']>(
  kind: K,
  quantityDescription?: string,
): Record<keyof CollectionSyncCopies<K>, JsonSchemaType> {
  return {
    kind: literal(kind),
    name: str(),
    quantity: int(quantityDescription ?? 'Copies.'),
    printing: COLLECTION_SYNC_PRINTING,
  }
}

const COLLECTION_SYNC_CHANGE_REQUIRED = ['kind', 'name', 'quantity', 'printing'] as const

const COLLECTION_SYNC_ADDED_PROPS = {
  ...collectionCopiesProps('added'),
  via: {
    ...literal('csv'),
    description: 'Present when a push’s CSV import created these copies.',
  },
} as const satisfies Record<keyof CollectionSyncCardAdded, JsonSchemaType>

const COLLECTION_SYNC_REMOVED: JsonSchemaType = obj(
  collectionCopiesProps('removed'),
  COLLECTION_SYNC_CHANGE_REQUIRED,
)

/** One `CollectionSyncCardChange`, discriminated by `kind`. */
const COLLECTION_SYNC_CARD_CHANGE: JsonSchemaType = {
  type: 'object',
  description: 'One card change, by `kind`.',
  oneOf: [
    obj(COLLECTION_SYNC_ADDED_PROPS, COLLECTION_SYNC_CHANGE_REQUIRED),
    COLLECTION_SYNC_REMOVED,
    obj(
      collectionCopiesProps(
        'pending',
        'Copies the CLI’s --csv-file wrote to a file rather than pushed; never on this surface.',
      ),
      COLLECTION_SYNC_CHANGE_REQUIRED,
    ),
  ],
}

/** One collection list's `CollectionSyncListResult`, checked against the engine type. */
const COLLECTION_SYNC_LIST_RESULT_PROPS = {
  name: str(),
  status: SYNC_ITEM_STATUS,
  outcome: SYNC_ITEM_OUTCOME,
  ...syncReasonProps('Why the list did not cleanly sync, or a dry run’s summary.'),
  added: int('Copies added: into the list on a pull, to Archidekt on a push.'),
  removed: int('Copies removed: from the list on a pull, from Archidekt on a push.'),
  pending: int('Copies written to a --csv-file rather than pushed (CLI only).'),
  changes: arr(
    COLLECTION_SYNC_CARD_CHANGE,
    'Every card change behind the counts (which are its totals), narrowed by `only`: what ' +
      'went through (or would have, on a dry run), one entry per card, printing and kind. A ' +
      'card whose write failed is left out; `reason` says what failed. On a push a card held ' +
      'in several lists is one key: the entry, with the key’s whole quantity, is listed under ' +
      'each. A list a cancellation skipped may still carry changes an earlier list’s turn ' +
      'made for it. Present only when there is at least one.',
  ),
} as const satisfies Record<keyof CollectionSyncListResult, JsonSchemaType>

/** The collection-sync report, checked against the engine type. */
const COLLECTION_SYNC_REPORT_PROPS = {
  direction: SYNC_DIRECTION,
  into: nullableStr('The list a pull added new cards to; null on a push.'),
  dryRun: bool(),
  lists: arr(
    obj(COLLECTION_SYNC_LIST_RESULT_PROPS, ['name', 'status', 'added', 'removed', 'pending']),
    'One sync outcome per collection list the run covered.',
  ),
  failedCount: int('Lists that failed; a run with failures still reports success.'),
  errors: arr(str(), 'Run-level failures, as opposed to per-list ones. English.'),
  errorMessages: arr(
    SYNC_MESSAGE,
    '`errors` as messages, in the same order: English `message` plus `messageKey` / ' +
      '`messageParams` for a client that renders them in its own language.',
  ),
  unreadable: arr(UNREADABLE_SOURCE, 'List files holding lines the parser cannot read.'),
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
      skipped: int('Changes the `only` filter skipped.'),
      pending: int('Copies written to a --csv-file rather than pushed (CLI only).'),
    } as const satisfies Record<keyof CollectionSyncTotals, JsonSchemaType>,
    ['added', 'removed', 'skipped', 'pending'],
  ),
  cancelled: bool(
    'True when the call was cancelled between lists; the lists never started are ' +
      'skipped and no lastSynced was recorded.',
  ),
  unresolvedAmbiguity: bool(
    'True when a pull stopped on ambiguous removals nobody placed — nothing was ' +
      'written; rerun with removalPriority or removalAssignments (or answer the ' +
      'elicitation this tool raises when the client supports it).',
  ),
  unlisted: arr(
    COLLECTION_SYNC_REMOVED,
    'A push’s removals of cards no in-scope list holds any more (they belong to no ' +
      'list’s changes); what went through. Present only when there is at least one.',
  ),
} as const satisfies Record<keyof CollectionSyncReport, JsonSchemaType>

export const SYNC_COLLECTION_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    summary: SYNC_SUMMARY,
    report: obj(COLLECTION_SYNC_REPORT_PROPS, [
      'direction',
      'into',
      'dryRun',
      'lists',
      'failedCount',
      'errors',
      'errorMessages',
      'unreadable',
      'ambiguous',
      'localIncomplete',
      'csv',
      'totals',
      'cancelled',
      'unresolvedAmbiguity',
    ]),
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
    code: enumOf(TOOL_ERROR_CODES),
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
