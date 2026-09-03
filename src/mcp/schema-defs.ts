/**
 * The shared half of the hand-authored output schemas: the builders, the
 * `$defs` fragments every tool root reuses, and the transitive `$ref` closure
 * that assembles them. The tool roots themselves — and the authoring rules all
 * of this obeys — live in `./schema-json`.
 */

import type { JsonSchemaType } from '@modelcontextprotocol/server'
import { LIST_TYPES } from '../list/list-type'
import { VALID_CONDITIONS, VALID_FINISHES } from '../card/finish-condition'
import { CARD_LABELS } from '../card/card-labels'
import { CARD_CATEGORY_SHAPE_CLAUSE } from '../card/card-categories'
import { CARD_LANGUAGES } from '../card/card-language'
import { UNPRICED_REASONS } from '../pricing/price-report'

// ── Builders ──────────────────────────────────────────────────────────

/** A property map, as every object schema declares one. */
export type Properties = Record<string, JsonSchemaType>

/**
 * An object schema whose `required` list is tied to its own property map.
 *
 * `required` naming a key `properties` does not declare is the failure this
 * generic exists to catch: Ajv would happily accept the schema and then reject
 * every real response for a missing key, turning a working tool into an
 * `isError` — and the authoring rules' own "required only when the handler
 * always sets it" had no static enforcement at all before this.
 */
export function obj<P extends Properties>(
  properties: P,
  required?: readonly (keyof P & string)[],
): JsonSchemaType {
  const schema: JsonSchemaType = { type: 'object', properties }
  if (required !== undefined && required.length > 0) schema.required = [...required]
  return schema
}

export function arr(items: JsonSchemaType, description?: string): JsonSchemaType {
  const schema: JsonSchemaType = { type: 'array', items }
  if (description !== undefined) schema.description = description
  return schema
}

export function str(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'string' } : { type: 'string', description }
}

export function num(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'number' } : { type: 'number', description }
}

export function int(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'integer' } : { type: 'integer', description }
}

export function bool(description?: string): JsonSchemaType {
  return description === undefined ? { type: 'boolean' } : { type: 'boolean', description }
}

export function enumOf(values: readonly string[], description?: string): JsonSchemaType {
  const schema: JsonSchemaType = { type: 'string', enum: [...values] }
  if (description !== undefined) schema.description = description
  return schema
}

export function literal(value: string): JsonSchemaType {
  return { type: 'string', const: value }
}

/** `T | null`, which JSON Schema spells as a two-arm `anyOf`. */
export function nullable(schema: JsonSchemaType, description?: string): JsonSchemaType {
  const wrapped: JsonSchemaType = { anyOf: [schema, { type: 'null' }] }
  if (description !== undefined) wrapped.description = description
  return wrapped
}

export function nullableStr(description?: string): JsonSchemaType {
  return nullable({ type: 'string' }, description)
}

export function ref(name: SharedDefName): JsonSchemaType {
  return { $ref: `#/$defs/${name}` }
}

/**
 * An open object: the key set is the payload owner's, not ours (see the Tier B
 * table in the phase plan). `description` is what carries the meaning here, so
 * it is required.
 */
export function openObject(description: string): JsonSchemaType {
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
  | 'ChangeEvent'
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

export const LIST_TYPE = enumOf(LIST_TYPES)
export const FINISH = enumOf(VALID_FINISHES)
export const CONDITION = enumOf(VALID_CONDITIONS)
export const CARD_LABEL = enumOf(CARD_LABELS)
/** One card tag as its owner wrote it: plain text, no `#` — the value `add-tag` takes. */
export const CARD_TAG = str(
  'A card tag, canonical: plain text in its owner\'s casing, without any "#" (e.g. "Ramp", "Card Draw").',
)
/**
 * One category name as its owner wrote it — plain text, the value the events
 * carry. The shape rule is interpolated from the engine's own clause, so the
 * advertised description can never drift from what the input schema refuses.
 */
export const CARD_CATEGORY = str(
  `A category name, canonical: ${CARD_CATEGORY_SHAPE_CLAUSE}, in its owner's casing (e.g. "Ramp", "Card Draw").`,
)

/**
 * A list's categories: the vocabulary in display order, and each card *name*'s
 * ordered assignments (first = primary). Keyed by name, never `&N`; open by
 * construction, since the key set is whichever cards the owner categorized.
 */
export const LIST_CATEGORIES: JsonSchemaType = obj(
  {
    order: arr(CARD_CATEGORY, 'The list’s category vocabulary, in display order.'),
    cards: {
      type: 'object',
      description:
        'Categories by card name, primary first. Case and spacing are folded when matched, ' +
        'so a card’s own `categories` field is the reliable per-card answer.',
      additionalProperties: arr(CARD_CATEGORY),
    },
  },
  ['order', 'cards'],
)

const LANGUAGE = enumOf(
  CARD_LANGUAGES,
  'Scryfall language code; absent means English ("en") — entries carry it only when not English.',
)

/**
 * One card's custom art: exactly one of an art-directory-relative file path or
 * an image URL — the raw reference, not a display URL, since it is also what
 * `set_card_art` takes back.
 */
export const CARD_ART_REF: JsonSchemaType = {
  anyOf: [
    obj({ file: str('Image path relative to the configured art directory.') }, ['file']),
    obj({ url: str('Image URL, referenced verbatim.') }, ['url']),
  ],
}

/**
 * A list's cover-image override: exactly one of a card line in that list (by its
 * `&N` id), an art-directory-relative file path, or a URL. Absent means the
 * built-in rule chooses the cover — a commander deck shows its commander, every
 * other list its most expensive printing — and `set_list_metadata` restores that
 * rule with `null`, never with a value.
 */
export const LIST_IMAGE_REF: JsonSchemaType = {
  description: 'The list’s cover image override; absent means the built-in cover rule applies.',
  anyOf: [
    obj({ card: int('The &N id of a card line in this list.') }, ['card']),
    obj({ file: str('Image path relative to the configured art directory.') }, ['file']),
    obj({ url: str('Image URL, referenced verbatim.') }, ['url']),
  ],
}

/**
 * A list's custom art, keyed by the `&N` id of the card it belongs to (a decimal
 * string, since JSON object keys are strings). Open by construction: the key set
 * is whichever cards have art.
 */
export const CUSTOM_ART_MAP: JsonSchemaType = {
  type: 'object',
  description:
    'Custom art by card &N id; present only when some card in this body has any. Set it with set_card_art.',
  additionalProperties: CARD_ART_REF,
}

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
export const PRINTING_IDENTITY_REQUIRED = [
  'scryfallId',
  'name',
  'set',
  'collectorNumber',
  'rarity',
  'finishes',
] as const satisfies readonly (keyof typeof PRINTING_IDENTITY_PROPS)[]

export const CARD_SUMMARY_PROPS = {
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
  unpricedCount: int(
    'Quantity-weighted count of unpriced entries; proxies and custom-art cards are not counted.',
  ),
} as const satisfies Properties
const PRICE_TOTALS_REQUIRED = [
  'cardCount',
  'total',
  'lowestTotal',
  'unpricedCount',
] as const satisfies readonly (keyof typeof PRICE_TOTALS_PROPS)[]

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

/** `note` + `cardId`: the per-line metadata any card-shaped payload carries. */
const LINE_META_PROPS = {
  note: str(),
  cardId: int('The entry’s persistent &N id.'),
} as const satisfies Properties

/**
 * {@link LINE_META_PROPS} plus `categories` and `tags`: what a *list entry*
 * carries beyond its name and printing. A physical card out of the move index
 * carries the line metadata only — it reports neither, so it must not advertise
 * them.
 */
const ENTRY_META_PROPS = {
  categories: arr(
    CARD_CATEGORY,
    'The card’s categories in this list, primary first; absent when it has none. Keyed by card ' +
      'name, so every line of that name reports the same list. Set them with apply_changes ' +
      '"set-categories".',
  ),
  tags: arr(
    CARD_TAG,
    'The line’s tags in canonical order (trimmed, sorted, no "#"); absent when it has none. ' +
      'Every list type carries them.',
  ),
  ...LINE_META_PROPS,
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

  DeckCard: obj(
    {
      quantity: int(),
      name: str(),
      ...ENTRY_PRINTING_PROPS,
      labels: arr(
        CARD_LABEL,
        'Per-card label override ("proxy"); effective labels are this, else the deck default.',
      ),
      ...ENTRY_META_PROPS,
    },
    ['quantity', 'name'],
  ),
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
      ...LINE_META_PROPS,
      copyIndex: int('Which copy of a multi-quantity deck line this is (0-based).'),
    },
    ['key', 'listType', 'listSlug', 'name'],
  ),

  // The event vocabulary is `ChangeEvent`'s in `src/changes/change-event.ts`
  // (the same shape import_change_bundle takes); open because the key set is
  // that discriminated union's, not this schema's.
  ChangeEvent: openObject(
    'One typed change event: `action` (add, remove, set-commander, unset-commander, set-finish, ' +
      'set-printing, set-language, set-note, set-label, add-tag, remove-tag, set-categories, ' +
      'rename-category, set-category-order, move-from, move-to, add-section, remove-section, ' +
      'rename-section, set-section) plus that action’s fields — cardName, cardId (&N), set, ' +
      'collectorNumber, finish, condition, language, labels, tags, tag, categories, category, ' +
      'newCategory, order, board, section, newSection, note, to/from ({type, name}). ' +
      'set-categories is keyed by card name and carries no cardId; rename-category and ' +
      'set-category-order target the list and carry no card at all.',
  ),
  ChangeSet: obj(
    {
      timestamp: str('ISO-8601 timestamp from the change set’s "## " header.'),
      lines: arr(str(), 'Prose change lines, each including its leading "- ".'),
      events: arr(
        ref('ChangeEvent'),
        'The set’s typed events, one per line in the same order (from its ritual-changes block). ' +
          'Empty for a legacy set that has no block.',
      ),
      trailing: arr(
        str(),
        'Hand-written non-change lines preserved after this set’s change lines (must not start ' +
          'with "- " or "## "). Absent when the set has none; echo it back on rewrite_history or ' +
          'the text is deleted.',
      ),
    },
    ['timestamp', 'lines', 'events'],
  ),

  ImportConflict: obj(
    {
      change: openObject('The change event that was skipped, verbatim from the bundle.'),
      reason: enumOf(['target-not-found', 'not-applicable', 'needs-printing']),
    },
    ['change', 'reason'],
  ),
  ListImportResult: obj(
    {
      kind: LIST_TYPE,
      slug: str(
        "The bundle's slug for the list, or the file basename it resolved to when the bundle " +
          'named it only as a move destination; empty when the list could not be resolved.',
      ),
      name: str(),
      applied: int(
        'Changes applied after dropping conflicts, moves arriving in the list included (a replacement printing written back to a move source is not counted).',
      ),
      conflicts: arr(ref('ImportConflict')),
      error: str(
        "Present when the list could not be resolved, loaded, or saved. The failing batch applied nothing and the list's later batches were skipped; batches already applied stay applied and are counted in `applied`.",
      ),
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
      unpricedReason: enumOf(
        UNPRICED_REASONS,
        'Why the entry has no price. "proxy" and "custom-art" state the card is priceless by rule rather than for want of data, and are the two that do not count as unpriced.',
      ),
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
export function defsFor(
  ...names: readonly SharedDefName[]
): Partial<Record<SharedDefName, JsonSchemaType>> {
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
          `schema-defs.ts: "${name}" references unknown fragment "#/$defs/${String(target)}".`,
        )
      }
      pending.push(target)
    }
  }
  const defs: Partial<Record<SharedDefName, JsonSchemaType>> = {}
  for (const name of [...seen].sort()) defs[name] = SHARED_DEFS[name]
  return defs
}

/** Assemble one tool's schema: an object root plus the `$defs` it references. */
export function withDefs(root: JsonSchemaType, ...names: readonly SharedDefName[]): JsonSchemaType {
  return { ...root, $defs: defsFor(...names) }
}
