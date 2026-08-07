import type { JsonSchemaType } from '@modelcontextprotocol/server'
import { DECK_FORMAT_KEYS } from '../deck-format'
import { LIST_TYPES } from '../list-type'
import type { McpToolName } from './tools/names'
import { VALID_CONDITIONS, VALID_FINISHES } from '../finish-condition'
import { CARD_LABELS } from '../card-labels'
import { CARD_LANGUAGES } from '../card-language'
import { CARD_BULK_TYPES } from '../scryfall/bulk-manifest'
import { VALID_CURRENCIES } from '../price-currency'
import { DIFF_BY_MODES } from '../list-diff'
import { BUYERS, SELL_MATCH_VIAS } from '../buylist'
import { SELL_ENTRY_STATUSES, SELL_NO_MATCH_REASONS } from '../sell-report'

/**
 * Hand-authored JSON Schema for every tool's `outputSchema`.
 *
 * **Why hand-authored, when the input schemas are zod.** The SDK converts a
 * Standard Schema by calling `schema['~standard'].jsonSchema[io]({ target })`
 * and nothing else — it never populates zod's `libraryOptions`, so `$defs`,
 * `$ref` reuse, `dependentRequired`, and `if`/`then` are unreachable from the
 * zod path. `fromJsonSchema()` accepts raw JSON Schema (Ajv-validated for real
 * at call time) and is the only route to them. It costs the callback's inferred
 * argument types (`fromJsonSchema<T = unknown>`), which is why **inputs stay on
 * zod**: typed handler arguments are worth more than schema compression there,
 * while an output schema has no arguments to lose.
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

// ── Builders ──────────────────────────────────────────────────────────

/** A property map, as every object schema declares one. */
type Properties = Record<string, JsonSchemaType>

/**
 * An object schema whose `required` list is tied to its own property map.
 *
 * `required` naming a key `properties` does not declare is the failure this
 * generic exists to catch: Ajv would happily accept the schema and then reject
 * every real response for a missing key, turning a working tool into an
 * `isError` — and the authoring rules' own "required only when the handler
 * always sets it" had no static enforcement at all before this.
 */
function obj<P extends Properties>(
  properties: P,
  required?: readonly (keyof P & string)[],
): JsonSchemaType {
  const schema: JsonSchemaType = { type: 'object', properties }
  if (required !== undefined && required.length > 0) schema.required = [...required]
  return schema
}

function arr(items: JsonSchemaType, description?: string): JsonSchemaType {
  const schema: JsonSchemaType = { type: 'array', items }
  if (description !== undefined) schema.description = description
  return schema
}

function str(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'string' } : { type: 'string', description }
}

function num(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'number' } : { type: 'number', description }
}

function int(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'integer' } : { type: 'integer', description }
}

function bool(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'boolean' } : { type: 'boolean', description }
}

function enumOf(values: readonly string[], description?: string): JsonSchemaType {
  const schema: JsonSchemaType = { type: 'string', enum: [...values] }
  if (description !== undefined) schema.description = description
  return schema
}

function literal(value: string): JsonSchemaType {
  return { type: 'string', const: value }
}

/** `T | null`, which JSON Schema spells as a two-arm `anyOf`. */
function nullable(schema: JsonSchemaType, description?: string): JsonSchemaType {
  const wrapped: JsonSchemaType = { anyOf: [schema, { type: 'null' }] }
  if (description !== undefined) wrapped.description = description
  return wrapped
}

function nullableStr(description?: string): JsonSchemaType {
  return nullable({ type: 'string' }, description)
}

function ref(name: SharedDefName): JsonSchemaType {
  return { $ref: `#/$defs/${name}` }
}

/**
 * An open object: the key set is the payload owner's, not ours (see the Tier B
 * table in the phase plan). `description` is what carries the meaning here, so
 * it is required.
 */
function openObject(description: string): JsonSchemaType {
  return { type: 'object', description }
}

// ── Shared `$defs` ────────────────────────────────────────────────────

/** Every fragment a tool schema may `$ref`. */
export type SharedDefName =
  | 'ListRef'
  | 'PrintingIdentity'
  | 'PrintingListing'
  | 'PrintingSummary'
  | 'CardSummary'
  | 'CardFaceSummary'
  | 'DeckData'
  | 'DeckSection'
  | 'DeckCard'
  | 'CollectionEntry'
  | 'WantedEntry'
  | 'ListCounts'
  | 'ListSectionCount'
  | 'SaveEffect'
  | 'SaveEffectPrinting'
  | 'DroppedNote'
  | 'PhysicalCard'
  | 'ChangeSet'
  | 'ImportConflict'
  | 'ListImportResult'
  | 'DiffMatch'
  | 'DiffOnly'
  | 'DiffPrinting'
  | 'DiffSideDetail'
  | 'PricedEntry'
  | 'ListPriceSummary'
  | 'ListTypeTotals'
  | 'PriceReportTotals'
  | 'ArchidektLoginStatus'
  | 'SyncableDeck'
  | 'CollectionSyncList'
  | 'DeckSyncStatusSection'
  | 'CollectionSyncStatusSection'
  | 'CsvRowFailure'

const LIST_TYPE = enumOf(LIST_TYPES)
const FINISH = enumOf(VALID_FINISHES)
const CONDITION = enumOf(VALID_CONDITIONS)
const CARD_LABEL = enumOf(CARD_LABELS)
const LANGUAGE = enumOf(
  CARD_LANGUAGES,
  'Scryfall language code; absent means English ("en") — entries carry it only when not English.',
)

/**
 * Scryfall's price key set is theirs, not ours, so this stays an open record of
 * nullable strings rather than an enumeration that would go stale (Tier B).
 */
const CARD_PRICES: JsonSchemaType = {
  type: 'object',
  description: 'Scryfall price strings by currency key; a missing price is null.',
  additionalProperties: { type: ['string', 'null'] },
}

const PRINTING_IDENTITY_PROPS = {
  scryfallId: str(),
  name: str(),
  set: str('Lowercase set code.'),
  collectorNumber: str(),
  rarity: str(),
  releasedAt: str('ISO-8601 release date; absent on the rare printing Scryfall dates.'),
  finishes: arr(str()),
  lang: str(
    'Scryfall language code of this card object; absent means English ("en"). With an ' +
      'all-cards-backed cache the same set:collectorNumber can appear once per language.',
  ),
} as const satisfies Properties
const PRINTING_IDENTITY_REQUIRED = [
  'scryfallId',
  'name',
  'set',
  'collectorNumber',
  'rarity',
  'finishes',
] as const

const CARD_SUMMARY_PROPS = {
  ...PRINTING_IDENTITY_PROPS,
  prices: CARD_PRICES,
  manaCost: str(),
  cmc: num(),
  typeLine: str(),
  oracleText: str(),
  colorIdentity: arr(str()),
} as const satisfies Properties

const PRICE_TOTALS_PROPS = {
  cardCount: int('Sum of quantities.'),
  total: num('Sum of unit price × quantity.'),
  lowestTotal: num('Sum of lowest unit price × quantity.'),
  unpricedCount: int('Quantity-weighted count of unpriced entries.'),
} as const satisfies Properties
const PRICE_TOTALS_REQUIRED = ['cardCount', 'total', 'lowestTotal', 'unpricedCount'] as const

/**
 * The printing an entry-shaped payload pins, spelled once.
 *
 * Every list entry, physical card, and save effect carries the same four fields
 * with the same meanings; written out per def they drifted (three different
 * wordings of the `cardId` description alone). A card *summary* is a different
 * shape and deliberately does not share these — it describes a Scryfall
 * printing, not a line in a file.
 */
const PRINTING_PROPS = {
  set: str('Lowercase set code.'),
  collectorNumber: str(),
  finish: FINISH,
  language: LANGUAGE,
} as const satisfies Properties

/** {@link PRINTING_PROPS} plus the grade, which wanted lists do not track. */
const ENTRY_PRINTING_PROPS = {
  ...PRINTING_PROPS,
  condition: CONDITION,
} as const satisfies Properties

/** `cardId` + `note`: what a list entry carries beyond its name and printing. */
const ENTRY_META_PROPS = {
  note: str(),
  cardId: int('The entry’s persistent &N id.'),
} as const satisfies Properties

/** Reusable `$defs` fragments. Each tool schema embeds only the subset it references. */
export const SHARED_DEFS: Readonly<Record<SharedDefName, JsonSchemaType>> = {
  // One vocabulary for naming a list, everywhere: `listType` + `slug`, exactly
  // the pair every tool takes as arguments. `list_lists` output used to spell it
  // that way while `find_cards`' roster and `diff_lists`' two sides spelled the
  // same three fields `type` + `slug` + `name`, so an agent was invited to feed
  // one straight into the other and hand a tool an undefined listType.
  ListRef: obj({ listType: LIST_TYPE, slug: str(), name: str() }, ['listType', 'slug', 'name']),

  PrintingIdentity: obj(PRINTING_IDENTITY_PROPS, PRINTING_IDENTITY_REQUIRED),
  // `get_card_printings` returns identity alone unless `includePrices` was set,
  // so `prices` is the one field that is genuinely optional on a printing.
  PrintingListing: obj(
    { ...PRINTING_IDENTITY_PROPS, prices: CARD_PRICES },
    PRINTING_IDENTITY_REQUIRED,
  ),
  PrintingSummary: obj({ ...PRINTING_IDENTITY_PROPS, prices: CARD_PRICES }, [
    ...PRINTING_IDENTITY_REQUIRED,
    'prices',
  ]),
  CardSummary: obj(CARD_SUMMARY_PROPS, [...PRINTING_IDENTITY_REQUIRED, 'prices']),
  CardFaceSummary: obj({ name: str(), manaCost: str(), typeLine: str(), oracleText: str() }, [
    'name',
  ]),

  DeckCard: obj({ quantity: int(), name: str(), ...ENTRY_PRINTING_PROPS, ...ENTRY_META_PROPS }, [
    'quantity',
    'name',
  ]),
  DeckSection: obj({ name: str(), cards: arr(ref('DeckCard')) }, ['name', 'cards']),
  DeckData: obj(
    {
      name: str(),
      format: str('Canonical deck-format key.'),
      sourceId: str(),
      sourceUrl: str(),
      description: str(),
      primer: str(),
      sections: arr(ref('DeckSection')),
    },
    ['name', 'sections'],
  ),

  CollectionEntry: obj(
    {
      name: str(),
      ...ENTRY_PRINTING_PROPS,
      labels: arr(
        CARD_LABEL,
        'Per-card label override; effective labels are this, else the list default.',
      ),
      ...ENTRY_META_PROPS,
      section: str(),
    },
    ['name', 'set', 'collectorNumber'],
  ),
  // No `condition`: a wanted list records what you want, not the grade of a
  // copy you hold.
  WantedEntry: obj({ name: str(), ...PRINTING_PROPS, ...ENTRY_META_PROPS, section: str() }, [
    'name',
  ]),

  ListSectionCount: obj(
    {
      name: str(),
      entryCount: int('Lines in the section.'),
      cardCount: int('Copies in the section (summed quantity).'),
    },
    ['name', 'entryCount', 'cardCount'],
  ),
  ListCounts: obj({ entryCount: int(), cardCount: int(), sections: arr(ref('ListSectionCount')) }, [
    'entryCount',
    'cardCount',
    'sections',
  ]),

  SaveEffectPrinting: obj(ENTRY_PRINTING_PROPS),
  SaveEffect: obj(
    {
      action: enumOf(['added', 'removed', 'updated']),
      cardId: int('The entry’s &N id, as allocated by this save.'),
      name: str(),
      section: str(),
      quantity: int('Copies on the line after the save; always 1 on a flat list.'),
      printing: ref('SaveEffectPrinting'),
      previousCardId: int(
        'Only on "updated": the &N id this line carried before the save renumbered it, ' +
          'because another entry arrived claiming the same number.',
      ),
    },
    ['action', 'cardId', 'name', 'quantity'],
  ),
  DroppedNote: obj({ cardName: str(), cardId: int(), note: str() }, ['cardName', 'note']),

  PhysicalCard: obj(
    {
      key: str('Opaque handle for this copy within a move session.'),
      listType: LIST_TYPE,
      listSlug: str(),
      name: str(),
      ...ENTRY_PRINTING_PROPS,
      ...ENTRY_META_PROPS,
      copyIndex: int('Which copy of a multi-quantity deck line this is (0-based).'),
    },
    ['key', 'listType', 'listSlug', 'name'],
  ),

  ChangeSet: obj(
    {
      timestamp: str('ISO-8601 timestamp from the change set’s "## " header.'),
      lines: arr(str(), 'Raw change lines, each including its leading "- ".'),
      trailing: arr(
        str(),
        'Hand-written non-change lines preserved after this set’s change lines (must not start ' +
          'with "- " or "## "). Absent when the set has none; echo it back on rewrite_history or ' +
          'the text is deleted.',
      ),
    },
    ['timestamp', 'lines'],
  ),

  ImportConflict: obj(
    {
      change: openObject('The change event that was skipped, verbatim from the bundle.'),
      reason: enumOf(['target-not-found', 'not-applicable']),
    },
    ['change', 'reason'],
  ),
  ListImportResult: obj(
    {
      kind: LIST_TYPE,
      slug: str(),
      name: str(),
      applied: int('Changes applied after dropping conflicts.'),
      conflicts: arr(ref('ImportConflict')),
      error: str('Present when the list could not be loaded or saved; nothing was applied.'),
    },
    ['kind', 'slug', 'name', 'applied', 'conflicts'],
  ),

  DiffPrinting: obj(
    {
      set: str('Lowercase set code; absent for the "(no printing)" bucket.'),
      collectorNumber: str(),
      finish: FINISH,
      language: LANGUAGE,
      quantity: int(),
    },
    ['quantity'],
  ),
  DiffSideDetail: obj({ quantity: int(), printings: arr(ref('DiffPrinting')) }, [
    'quantity',
    'printings',
  ]),
  DiffMatch: obj({ name: str(), a: ref('DiffSideDetail'), b: ref('DiffSideDetail') }, [
    'name',
    'a',
    'b',
  ]),
  DiffOnly: obj({ name: str(), quantity: int(), printings: arr(ref('DiffPrinting')) }, [
    'name',
    'quantity',
    'printings',
  ]),

  PricedEntry: obj(
    {
      listType: LIST_TYPE,
      listName: str(),
      section: str(),
      name: str(),
      quantity: int(),
      set: str('Lowercase set code of the printing priced.'),
      collectorNumber: str(),
      finish: FINISH,
      pinned: bool('Whether set/collectorNumber came from the list entry itself.'),
      price: num('Unit price in the report currency; 0 when unpriced.'),
      lowest: num('Cheapest acceptable unit price; 0 when unavailable.'),
      lowestSet: str('Lowercase set code of the printing behind `lowest`.'),
      lowestCollectorNumber: str('Collector number of the printing behind `lowest`.'),
      lowestFinish: enumOf(VALID_FINISHES, 'Finish of the printing behind `lowest`.'),
      unpricedReason: enumOf([
        'no-printings',
        'printing-not-found',
        'currency-unavailable',
        'finish-unpriced-in-currency',
        'no-price-data',
      ]),
      cmc: num(),
      edhrecRank: int(),
      typeLine: str(),
      fileOrder: int('Position of the entry in its list file.'),
    },
    [
      'listType',
      'listName',
      'section',
      'name',
      'quantity',
      'pinned',
      'price',
      'lowest',
      'cmc',
      'edhrecRank',
      'typeLine',
      'fileOrder',
    ],
  ),
  ListPriceSummary: obj({ ...PRICE_TOTALS_PROPS, type: LIST_TYPE, name: str() }, [
    ...PRICE_TOTALS_REQUIRED,
    'type',
    'name',
  ]),
  ListTypeTotals: obj({ ...PRICE_TOTALS_PROPS, type: LIST_TYPE, listCount: int() }, [
    ...PRICE_TOTALS_REQUIRED,
    'type',
    'listCount',
  ]),
  PriceReportTotals: obj({ ...PRICE_TOTALS_PROPS, listCount: int() }, [
    ...PRICE_TOTALS_REQUIRED,
    'listCount',
  ]),

  ArchidektLoginStatus: obj(
    {
      loggedIn: bool(),
      username: nullableStr(),
      accessTokenExpiration: nullableStr(),
      accessTokenValid: bool(),
      refreshTokenExpiration: nullableStr(),
      refreshTokenValid: bool(),
      loginRequired: bool('True when neither token is valid, so a sync tool cannot run.'),
    },
    [
      'loggedIn',
      'username',
      'accessTokenExpiration',
      'accessTokenValid',
      'refreshTokenExpiration',
      'refreshTokenValid',
      'loginRequired',
    ],
  ),
  SyncableDeck: obj(
    {
      slug: str(),
      name: str(),
      sourceId: str(),
      sourceUrl: str(),
      lastSynced: nullableStr(),
    },
    ['slug', 'name', 'sourceId', 'sourceUrl', 'lastSynced'],
  ),
  CollectionSyncList: obj({ slug: str(), name: str() }, ['slug', 'name']),

  // The two halves of `get_sync_status`, as `$defs` rather than inline objects:
  // they mirror named TS types (`DeckSyncStatusSection` /
  // `CollectionSyncStatusSection` in `tools/read-tools.ts`), and a named
  // fragment is what keeps the two from being edited apart.
  DeckSyncStatusSection: obj(
    { decks: arr(ref('SyncableDeck')), archidekt: ref('ArchidektLoginStatus') },
    ['decks', 'archidekt'],
  ),
  CollectionSyncStatusSection: obj(
    {
      lists: arr(ref('CollectionSyncList')),
      archidekt: ref('ArchidektLoginStatus'),
      lastSynced: nullableStr('ISO timestamp of the last applying sync; null if never.'),
      pullTarget: str('Collection list a pull adds new cards to by default.'),
      csvThreshold: int('New printings above which a push needs csv: true.'),
    },
    ['lists', 'archidekt', 'lastSynced', 'pullTarget', 'csvThreshold'],
  ),

  CsvRowFailure: obj({ lineNumber: int(), raw: str(), reason: str() }, [
    'lineNumber',
    'raw',
    'reason',
  ]),
}

const DEF_REF_RE = /"\$ref":"#\/\$defs\/([A-Za-z]+)"/g

/** Whether a `$ref` target names a fragment {@link SHARED_DEFS} actually holds. */
function isSharedDefName(value: string): value is SharedDefName {
  return Object.hasOwn(SHARED_DEFS, value)
}

/**
 * Build the `$defs` map a schema needs, closed transitively over `$ref`s.
 *
 * The closure is read out of the fragments themselves rather than declared
 * beside them, so adding a `$ref` inside a def cannot leave its target
 * unresolved — which Ajv would only report at call time, as an `isError`.
 *
 * A reference to a fragment that does not exist throws, and because every tool
 * schema is assembled at module load, it throws there: the server refuses to
 * start rather than advertising a schema that turns one tool into an error
 * result the first time it is called.
 */
export function defsFor(...names: readonly SharedDefName[]): Record<string, JsonSchemaType> {
  const pending = [...names]
  const seen = new Set<SharedDefName>()
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === undefined || seen.has(name)) continue
    seen.add(name)
    for (const match of JSON.stringify(SHARED_DEFS[name]).matchAll(DEF_REF_RE)) {
      const target = match[1]
      if (target === undefined || !isSharedDefName(target)) {
        throw new Error(
          `schema-json.ts: "${name}" references unknown fragment "#/$defs/${String(target)}".`,
        )
      }
      pending.push(target)
    }
  }
  const defs: Record<string, JsonSchemaType> = {}
  for (const name of [...seen].sort()) defs[name] = SHARED_DEFS[name]
  return defs
}

/** Assemble one tool's schema: an object root plus the `$defs` it references. */
function withDefs(root: JsonSchemaType, ...names: readonly SharedDefName[]): JsonSchemaType {
  return { ...root, $defs: defsFor(...names) }
}

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
          labels: arr(
            CARD_LABEL,
            'The collection’s default card labels from front matter (collections only).',
          ),
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
  ['priceBuy', 'qtyBuying', 'buying', 'finish', 'matchVia', 'productId', 'name', 'edition'],
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

export const CONFIG_OUTPUT: JsonSchemaType = obj(
  {
    config: openObject(
      'The effective Ritual configuration: ritual.config.json merged over the ' +
        'built-in defaults (the file is optional and may not exist yet).',
    ),
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

export const CREATE_LIST_OUTPUT: JsonSchemaType = obj(
  { message: str(), slug: str('The new list’s slug — how every other tool addresses it.') },
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
      'Non-fatal notices about text that WAS imported (e.g. a card name still carrying a printing token). Empty for URL imports.',
    ),
  },
  ['message', 'deckName', 'warnings', 'advisories'],
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
      failedCount: int('Lists that could not be loaded or saved; the rest still applied.'),
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
        name: str(),
        format: enumOf(DECK_FORMAT_KEYS, 'Canonical deck-format key.'),
        created: str('ISO-8601 creation date.'),
        tags: arr(str()),
        description: str(),
        sourceId: str('The deck’s id on the source service.'),
        sourceUrl: str('The deck’s URL on the source service.'),
        lastSynced: str('ISO-8601 time of the last successful source sync.'),
        labels: arr(CARD_LABEL, 'The collection’s default card labels (collections only).'),
      },
    },
  },
  ['slug', 'frontMatter'],
)

export const MUTATION_OUTPUT: JsonSchemaType = withDefs(
  obj(
    {
      applied: int('Changes applied; equal to the batch size, since edits are all-or-nothing.'),
      message: str(),
      listType: LIST_TYPE,
      slug: str(),
      effects: arr(
        ref('SaveEffect'),
        'What the save did to individual entries, with the &N ids it allocated.',
      ),
      unmatched: arr(str(), 'Always empty on a returning call; a miss fails the whole batch.'),
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
      message: str(),
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
    message: str(),
  },
  ['removed', 'requested', 'skipped', 'warnings', 'message'],
)

export const RENAME_LIST_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    newSlug: str('Address the list by this from now on.'),
    newFilePath: str('The list’s file path after the rename.'),
    oldFilePath: str('The path it occupied before the rename.'),
  },
  ['message', 'newSlug', 'newFilePath', 'oldFilePath'],
)

export const DELETE_LIST_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
    deletedFiles: arr(str(), 'Every file removed: the list plus whichever sidecars it had.'),
  },
  ['message', 'deletedFiles'],
)

export const REWRITE_HISTORY_OUTPUT: JsonSchemaType = obj(
  { message: str(), setCount: int('Change sets written.') },
  ['message', 'setCount'],
)

export const BUILD_SITE_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
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
export const REFRESH_CACHE_OUTPUT: JsonSchemaType = obj({ message: str() }, ['message'])

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

const SYNC_DIRECTION = enumOf(['pull', 'push'])

export const SYNC_DECKS_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
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
  ['message', 'report'],
)

export const SYNC_COLLECTION_OUTPUT: JsonSchemaType = obj(
  {
    message: str(),
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
  ['message', 'report'],
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
  get_config: CONFIG_OUTPUT,
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
