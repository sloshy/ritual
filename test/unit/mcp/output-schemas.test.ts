import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Client } from '@modelcontextprotocol/client'
import { fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server'
import {
  BUILD_SITE_OUTPUT,
  CONFIG_OUTPUT,
  CREATE_LIST_OUTPUT,
  DELETE_LIST_OUTPUT,
  EXPORT_CARDS_OUTPUT,
  FIND_CARDS_OUTPUT,
  GET_CACHE_STATUS_OUTPUT,
  GET_CARD_PRINTINGS_OUTPUT,
  GET_CONFIG_OUTPUT,
  GET_HISTORY_OUTPUT,
  GET_LIST_OUTPUT,
  GET_PRICE_REPORT_OUTPUT,
  IMPORT_CSV_OUTPUT,
  MOVE_SELECTED_CARDS_OUTPUT,
  MUTATION_OUTPUT,
  REFRESH_CACHE_OUTPUT,
  REMOVE_SELECTED_CARDS_OUTPUT,
  RENAME_LIST_OUTPUT,
  REWRITE_HISTORY_OUTPUT,
  SET_CARD_ART_OUTPUT,
  SYNC_COLLECTION_OUTPUT,
  SYNC_DECKS_OUTPUT,
  TOOL_ERROR_OUTPUT,
  TOOL_OUTPUT_SCHEMAS,
} from '../../../src/mcp/schema-json'
import { defsFor } from '../../../src/mcp/schema-defs'
import { apiErrorToMcp } from '../../../src/mcp/errors'
import { toToolErrorPayload } from '../../../src/mcp/result'
import { MCP_TOOL_NAMES } from '../../../src/mcp/tools/names'
import { VALID_FINISHES } from '../../../src/card/finish-condition'
import { CARD_LANGUAGES } from '../../../src/card/card-language'
import { BY_RULE_UNPRICED_REASONS, UNPRICED_REASONS } from '../../../src/pricing/price-report'
import type { BuildSiteResult, DeckSyncResult } from '../../../src/mcp/tools/destructive-tools'
import type { ImportCsvResponse } from '../../../src/admin/api/import-csv'
import type { CollectionSyncReport } from '../../../src/collection-sync/engine'
import { setupMcpClient, type McpTestSession } from './harness'

/**
 * The drift net for the hand-authored output schemas.
 *
 * There are three independent checks here and they cover different failures:
 * emitted-equals-authored catches a change in how the SDK converts a schema;
 * the per-tool root pins catch an edit to a schema whose shape carries contract
 * meaning; the catalogue-wide invariants catch a schema authored by copying an
 * *input* schema, which is the mistake that would ship `format` or
 * `additionalProperties: false` and turn a working tool into an `isError`.
 *
 * Explicit expectations rather than snapshot files, deliberately: a schema diff
 * has to be readable in review, not a regenerated `.snap`.
 *
 * Only the first group needs a live server, so only it pays for a temp
 * workspace and a connected client; everything below reads the authored
 * constants directly.
 */

/** A JSON Schema node, as far as these assertions walk one. */
type SchemaNode = {
  type?: unknown
  format?: unknown
  $schema?: unknown
  additionalProperties?: SchemaNode | boolean
  minimum?: unknown
  maximum?: unknown
  properties?: Record<string, SchemaNode>
  required?: string[]
  const?: unknown
  enum?: unknown[]
  oneOf?: SchemaNode[]
  anyOf?: SchemaNode[]
  items?: SchemaNode
  $ref?: unknown
  $defs?: Record<string, SchemaNode>
}

/**
 * Every nested schema object reachable from a root, root included.
 *
 * Descends only through the keywords that *hold* schemas — a property literally
 * named `format` (as `DeckData` has) is a property name, not the `format`
 * keyword, and a blind recursive walk would report it as one.
 */
function walk(node: unknown): SchemaNode[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return []
  const self = node as SchemaNode
  const record = node as Record<string, unknown>
  const children: SchemaNode[] = []
  for (const key of ['properties', '$defs'] as const) {
    const map = record[key]
    if (typeof map === 'object' && map !== null) {
      children.push(...Object.values(map).flatMap(walk))
    }
  }
  for (const key of ['items', 'additionalProperties'] as const) {
    children.push(...walk(record[key]))
  }
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = record[key]
    if (Array.isArray(branches)) children.push(...branches.flatMap(walk))
  }
  return [self, ...children]
}

/** Validate a sample payload through the very Ajv instance the SDK calls at runtime. */
async function validates(schema: JsonSchemaType, sample: unknown): Promise<boolean> {
  const result = await fromJsonSchema(schema)['~standard'].validate(sample)
  return result.issues === undefined
}

/**
 * An entry-only field advertised on all three list-entry fragments as an
 * optional array of plain strings — the shape both `categories` and `tags` have,
 * asserted once so a third such field is one call rather than another copy. Each
 * caller keeps its own contrast (which fragments must *not* advertise it), since
 * that is what distinguishes them.
 */
function expectEntryOnlyStringArray(field: 'categories' | 'tags'): void {
  for (const def of ['DeckCard', 'CollectionEntry', 'WantedEntry'] as const) {
    const schema = defsFor(def)[def] as unknown as SchemaNode
    expect({
      def,
      type: schema.properties?.[field]?.type,
      items: schema.properties?.[field]?.items?.type,
    }) //
      .toEqual({ def, type: 'array', items: 'string' })
    // Absent means none, so the field must never be required.
    expect(schema.required ?? []).not.toContain(field)
  }
}

describe('MCP output schemas, as advertised over a connection', () => {
  let session: McpTestSession
  let client: Client

  beforeEach(async () => {
    session = await setupMcpClient('schema-test')
    client = session.client
  })

  afterEach(async () => {
    await session.close()
  })

  test('every tool advertises the schema this module authored, byte for byte', async () => {
    // What this pins is the *registration mapping* plus the SDK's round trip:
    // that each tool is handed the constant this module names for it, and that
    // the constant survives conversion unchanged. It says nothing about whether
    // a schema describes its handler correctly — that is what the sample
    // conformance and the per-tool root pins below are for.
    const { tools } = await client.listTools()
    // Keyed by the tool-name union, so look it up through a string-keyed view
    // rather than asserting a live catalogue name is one of those literals.
    const authoredByName: ReadonlyMap<string, JsonSchemaType> = new Map(
      Object.entries(TOOL_OUTPUT_SCHEMAS),
    )
    for (const tool of tools) {
      const authored = authoredByName.get(tool.name)
      expect({ name: tool.name, declared: tool.outputSchema !== undefined }) //
        .toEqual({ name: tool.name, declared: true })
      expect(authored).toBeDefined()
      expect(tool.outputSchema).toEqual(authored)
    }
    // No stale entries either: the map and the catalogue are the same key set.
    expect(Object.keys(TOOL_OUTPUT_SCHEMAS).sort()).toEqual([...MCP_TOOL_NAMES].sort())
  })

  test('every advertised output schema obeys the authoring rules', async () => {
    const { tools } = await client.listTools()
    for (const tool of tools) {
      const root = tool.outputSchema as unknown as SchemaNode
      // An object root is what makes the 2025 and 2026 codecs agree: a
      // non-object root is silently re-wrapped as `{result: …}` on the legacy leg.
      expect({ name: tool.name, rootType: root.type }).toEqual({
        name: tool.name,
        rootType: 'object',
      })
      for (const node of walk(root)) {
        expect({ name: tool.name, hasSchemaKey: node.$schema !== undefined }) //
          .toEqual({ name: tool.name, hasSchemaKey: false })
        // `format` is Ajv-enforced at call time, so a near-miss timestamp would
        // degrade a working tool into an error result.
        expect({ name: tool.name, hasFormat: node.format !== undefined }) //
          .toEqual({ name: tool.name, hasFormat: false })
        // Closed objects would break the moment a handler response is widened.
        expect({ name: tool.name, closed: node.additionalProperties === false }) //
          .toEqual({ name: tool.name, closed: false })
        // Numeric bounds guide a *caller*, so they belong on inputs. The
        // catalogue-wide MAX_SAFE_INTEGER purge only catches the one value these
        // would most often carry; this catches the keywords themselves.
        expect({
          name: tool.name,
          bounded: node.minimum !== undefined || node.maximum !== undefined,
        }).toEqual({ name: tool.name, bounded: false })
      }
    }
  })
})

describe('MCP output schemas, as authored', () => {
  test('the schemas whose shape is a contract pin their exact roots', () => {
    // get_list: three branches, each self-describing through `view` + `listType`.
    const listBranches = (GET_LIST_OUTPUT as unknown as SchemaNode).oneOf ?? []
    expect(listBranches).toHaveLength(3)
    expect(listBranches.map((b) => Object.keys(b.properties ?? {}))).toEqual([
      [
        'view',
        'listType',
        'slug',
        'warnings',
        'deck',
        'frontMatter',
        'labels',
        'image',
        'customArt',
        'totalCount',
        'artWarnings',
        'categories',
        'categoryWarnings',
      ],
      [
        'view',
        'listType',
        'slug',
        'warnings',
        'entries',
        'sectionOrder',
        'description',
        'labels',
        'image',
        'customArt',
        'totalCount',
        'artWarnings',
        'categories',
        'categoryWarnings',
      ],
      ['view', 'listType', 'slug', 'warnings', 'counts'],
    ])
    // Custom art rides beside the entries, keyed by &N, on both cards arms — a
    // client that can edit it needs the raw {file}/{url} reference, so the map's
    // values must stay the two-arm reference and never a display URL.
    for (const branch of listBranches.slice(0, 2)) {
      const artValues = branch.properties?.customArt?.additionalProperties
      const artArms = typeof artValues === 'object' ? (artValues.anyOf ?? []) : []
      expect(artArms.map((arm) => Object.keys(arm.properties ?? {}))).toEqual([['file'], ['url']])
      // Never required: a list whose cards have no art omits the key entirely.
      expect(branch.required ?? []).not.toContain('customArt')
    }
    // The cover override is the same three-arm reference on both cards arms, and
    // never required: a list with no `image:` key omits it, which is how an agent
    // tells "the built-in cover rule applies" from "a cover is set".
    for (const branch of listBranches.slice(0, 2)) {
      const imageArms = branch.properties?.image?.anyOf ?? []
      expect(imageArms.map((arm) => Object.keys(arm.properties ?? {}))).toEqual([
        ['card'],
        ['file'],
        ['url'],
      ])
      expect(branch.required ?? []).not.toContain('image')
    }
    // `warnings` is required on all three arms, not merely present: a client
    // that never sees the key is a client that reads a truncated list as whole.
    for (const branch of listBranches) {
      expect(branch.required).toContain('warnings')
    }
    // `artWarnings` is the opposite: a separate, optional channel. Folding a
    // custom-art problem into `warnings` would read as "this list has lines a
    // mutation would eat", which is what that channel promises and art is not.
    for (const branch of listBranches.slice(0, 2)) {
      expect(branch.required ?? []).not.toContain('artWarnings')
    }
    expect(listBranches[2]?.properties?.artWarnings).toBeUndefined()
    // Categories ride beside the entries too, keyed by card NAME: `order` is the
    // vocabulary and `cards` is an open map of name → ordered category list.
    // Never required — absent means the list has none, which is the same rule
    // the per-card field obeys.
    for (const branch of listBranches.slice(0, 2)) {
      const categories = branch.properties?.categories
      expect(categories?.properties?.order?.items?.type).toBe('string')
      expect(categories?.properties?.cards?.type).toBe('object')
      const cardValues = categories?.properties?.cards?.additionalProperties
      expect(typeof cardValues === 'object' ? cardValues.type : undefined).toBe('array')
      expect(typeof cardValues === 'object' ? cardValues.items?.type : undefined).toBe('string')
      expect(branch.required ?? []).not.toContain('categories')
      expect(branch.required ?? []).not.toContain('categoryWarnings')
    }
    expect(listBranches[2]?.properties?.categories).toBeUndefined()
    for (const branch of listBranches) {
      expect(branch.required).toContain('view')
      expect(branch.required).toContain('listType')
    }
    // The discriminant *values*, not merely their presence: a client picks its
    // branch by reading these two strings, so "cards"/"summary" and the deck
    // arm's pinned listType are the contract.
    expect(listBranches.map((b) => b.properties?.view?.const)).toEqual([
      'cards',
      'cards',
      'summary',
    ])
    expect(listBranches[0]?.properties?.listType?.const).toBe('deck')

    // The mutation result: `effects` and `unmatched` are the fields that killed
    // the post-write `get_list` round trip, so they are required, not optional.
    const mutation = MUTATION_OUTPUT as unknown as SchemaNode
    expect(Object.keys(mutation.properties ?? {})).toEqual([
      'applied',
      'message',
      // The localization pair every other admin-authored result carries.
      'messageKey',
      'messageParams',
      'listType',
      'slug',
      'effects',
      'unmatched',
      // The sidecar channels a save reports on, mirroring get_list's arms.
      'artWarnings',
      'categoryWarnings',
      'prunedCategories',
    ])
    expect(mutation.required).toEqual([
      'applied',
      'message',
      'listType',
      'slug',
      'effects',
      'unmatched',
    ])
    // Optional, like the load routes' copy: a save whose art reconcile was
    // clean says nothing at all rather than an empty list. The two categories
    // channels obey the same rule.
    expect(mutation.required ?? []).not.toContain('artWarnings')
    expect(mutation.required ?? []).not.toContain('categoryWarnings')
    expect(mutation.required ?? []).not.toContain('prunedCategories')

    // The three other schemas that report a categories channel the handler
    // already sends: the two cross-list batches prune the lists they write, and
    // get_history says when it could not read the sidecar it derives category
    // events from. All optional — nothing pruned means nothing said.
    const categoryChannels: { schema: JsonSchemaType; field: string }[] = [
      { schema: MOVE_SELECTED_CARDS_OUTPUT, field: 'prunedCategories' },
      { schema: REMOVE_SELECTED_CARDS_OUTPUT, field: 'prunedCategories' },
      { schema: GET_HISTORY_OUTPUT, field: 'categoryWarnings' },
    ]
    for (const { schema, field } of categoryChannels) {
      const node = schema as unknown as SchemaNode
      expect(Object.keys(node.properties ?? {})).toContain(field)
      expect(node.properties?.[field]?.items?.type).toBe('string')
      expect(node.required ?? []).not.toContain(field)
    }

    // set_card_art echoes what the card now carries, and `art` is required with
    // `null` as a *value*: a cleared card carries nothing, and an omitted key
    // would be indistinguishable from a handler that forgot to report.
    const setCardArt = SET_CARD_ART_OUTPUT as unknown as SchemaNode
    expect(Object.keys(setCardArt.properties ?? {})).toEqual([
      'message',
      'messageKey',
      'messageParams',
      'slug',
      'cardId',
      'art',
    ])
    expect(setCardArt.required).toEqual(['message', 'slug', 'cardId', 'art'])
    expect((setCardArt.properties?.art?.anyOf ?? []).at(-1)?.type).toBe('null')

    // export_cards and get_price_report are both unions; each must be
    // discriminable by a single const-valued key, and the two values a client
    // branches on are themselves the contract.
    type UnionPin = { schema: JsonSchemaType; key: string; values: string[] }
    const unionPins: UnionPin[] = [
      { schema: EXPORT_CARDS_OUTPUT, key: 'mode', values: ['content', 'file'] },
      { schema: GET_PRICE_REPORT_OUTPUT, key: 'mode', values: ['summary', 'list'] },
    ]
    for (const { schema, key, values } of unionPins) {
      const branches = (schema as unknown as SchemaNode).oneOf ?? []
      expect(branches).toHaveLength(values.length)
      for (const branch of branches) expect(branch.required).toContain(key)
      expect(branches.map((b) => b.properties?.[key]?.const)).toEqual(values)
    }

    // PricedEntry: both finish fields are the shared enum, not free strings. The
    // report only ever emits a modelled finish, so a client can switch on them.
    // `unpricedReason` is the engine's own list — the by-rule reasons (`proxy`
    // and `custom-art`, cards with no price by rule rather than for want of
    // data) must reach a client that branches on why a price is missing.
    const pricedEntry = defsFor('PricedEntry')['PricedEntry'] as unknown as SchemaNode
    for (const field of ['finish', 'lowestFinish']) {
      expect(pricedEntry.properties?.[field]?.enum).toEqual([...VALID_FINISHES])
    }
    const unpricedReasons = pricedEntry.properties?.['unpricedReason']?.enum ?? []
    expect(unpricedReasons).toEqual([...UNPRICED_REASONS])
    for (const reason of BY_RULE_UNPRICED_REASONS) expect(unpricedReasons).toContain(reason)

    // The config pair: only `get_config` reports what a session flag (`--sell-mode`)
    // displaced, and `overrides` must stay *optional* — its absence is what says
    // "this server runs the stored config", so requiring it would make every
    // ordinary read fail Ajv. `update_config` echoes what it persisted and
    // therefore never carries the key at all.
    const getConfig = GET_CONFIG_OUTPUT as unknown as SchemaNode
    expect(Object.keys(getConfig.properties ?? {})).toEqual(['config', 'overrides'])
    expect(getConfig.required).toEqual(['config'])
    expect(Object.keys(getConfig.properties?.overrides?.properties ?? {})).toEqual([
      'site.sellMode',
    ])
    expect(Object.keys((CONFIG_OUTPUT as unknown as SchemaNode).properties ?? {})).toEqual([
      'config',
    ])

    // find_cards: `lists` rides on an opt-in flag, so it must stay optional.
    const findCards = FIND_CARDS_OUTPUT as unknown as SchemaNode
    expect(findCards.required).toEqual(['cards', 'warnings'])
    expect(Object.keys(findCards.properties ?? {})).toContain('lists')

    // import_csv: `success` became a pure envelope flag, so the per-row report is
    // what a client branches on. Both `failures` and `failedCount` are required —
    // an optional pair is exactly how a partially-failed import reads as a clean
    // one to a client that never checks.
    const importCsv = IMPORT_CSV_OUTPUT as unknown as SchemaNode
    // `warnings` is required for the same reason: an agent has no header wizard,
    // so the assumption the handler made about the first row must always be there.
    expect(Object.keys(importCsv.properties ?? {})).toEqual([
      'message',
      'cardCount',
      'failures',
      'failedCount',
      'warnings',
    ])
    expect(importCsv.required).toEqual([
      'message',
      'cardCount',
      'failures',
      'failedCount',
      'warnings',
    ])
  })

  test('the language vocabulary rides on every entry-shaped and printing-shaped fragment', () => {
    // Entry-shaped payloads (list entries, physical cards, save effects) carry
    // `language` as the shared enum — the same 17 codes the input schemas
    // accept, so what a write sent comes back under the same vocabulary.
    for (const def of [
      'DeckCard',
      'CollectionEntry',
      'WantedEntry',
      'PhysicalCard',
      'SaveEffectPrinting',
      'DiffPrinting',
    ] as const) {
      const schema = defsFor(def)[def] as unknown as SchemaNode
      expect({ def, enum: schema.properties?.language?.enum }) //
        .toEqual({ def, enum: [...CARD_LANGUAGES] })
      // Absent means English, so `language` must never be required.
      expect(schema.required ?? []).not.toContain('language')
    }

    // Scryfall-card-shaped payloads spell it `lang` (Scryfall's own field): a
    // free string, since the cache stores whatever the bulk carried.
    for (const def of ['PrintingIdentity', 'PrintingListing', 'PrintingSummary'] as const) {
      const schema = defsFor(def)[def] as unknown as SchemaNode
      expect({ def, lang: schema.properties?.lang?.type }).toEqual({ def, lang: 'string' })
      expect(schema.required ?? []).not.toContain('lang')
    }

    // get_card_printings always reports the language rollup.
    const printings = GET_CARD_PRINTINGS_OUTPUT as unknown as SchemaNode
    expect(printings.properties?.languages?.type).toBe('array')
    expect(printings.required).toContain('languages')

    // get_cache_status reports the bulk provenance that language support added,
    // and all three fields are always set by the collector.
    const cacheStatus = GET_CACHE_STATUS_OUTPUT as unknown as SchemaNode
    expect(cacheStatus.properties?.defaultLanguage?.enum).toEqual([...CARD_LANGUAGES])
    for (const field of ['defaultLanguage', 'cardBulkType', 'bulkTypeStale']) {
      expect(cacheStatus.required).toContain(field)
    }
    const bulkTypeArms = cacheStatus.properties?.cardBulkType?.anyOf ?? []
    expect(bulkTypeArms.map((arm) => arm.enum ?? arm.type)).toEqual([
      ['default_cards', 'all_cards'],
      'null',
    ])
  })

  test('every list-entry fragment carries its categories, as plain strings', () => {
    // Categories ride on every entry shape on every list type, as an optional
    // array of plain strings in the owner's own casing, primary first.
    expectEntryOnlyStringArray('categories')
    // A physical card out of the move index and a save effect never report
    // categories, so neither may advertise the field — the same contrast the
    // tags test draws.
    const physical = defsFor('PhysicalCard').PhysicalCard as unknown as SchemaNode
    expect(physical.properties?.categories).toBeUndefined()
    const effect = defsFor('SaveEffect').SaveEffect as unknown as SchemaNode
    expect(effect.properties?.categories).toBeUndefined()
  })

  test('every list-entry fragment carries the card tags, as canonical strings', () => {
    // Tags ride on every entry shape on every list type — unlike labels, which
    // a wanted entry never carries — as an optional array of plain strings: the
    // canonical value (lowercase, no "#"), never the card-line token.
    expectEntryOnlyStringArray('tags')
    // The contrast the comment draws: a wanted entry has tags but no labels.
    const wanted = defsFor('WantedEntry').WantedEntry as unknown as SchemaNode
    expect(wanted.properties?.labels).toBeUndefined()
    // A physical card out of the move index carries no tags, so find_cards must
    // not promise a field its handler never sends.
    const physical = defsFor('PhysicalCard').PhysicalCard as unknown as SchemaNode
    expect(physical.properties?.tags).toBeUndefined()
  })

  test('defsFor closes transitively over $refs', () => {
    // DeckData refs DeckSection, which refs DeckCard — a schema that named only
    // the first would leave two dangling `$ref`s Ajv rejects at call time.
    expect(Object.keys(defsFor('DeckData'))).toEqual(['DeckCard', 'DeckData', 'DeckSection'])
  })

  test('every $ref in every tool schema resolves inside that schema', () => {
    // `defsFor` throws at module load on a reference to a fragment that does not
    // exist at all; this is the other half — a fragment that exists but was not
    // pulled into the schema that references it, which Ajv would only report as
    // an `isError` the first time the tool ran.
    for (const [name, schema] of Object.entries(TOOL_OUTPUT_SCHEMAS)) {
      const root = schema as unknown as SchemaNode
      const available = new Set(Object.keys(root.$defs ?? {}))
      for (const match of JSON.stringify(schema).matchAll(/"\$ref":"#\/\$defs\/([A-Za-z]+)"/g)) {
        expect({ tool: name, def: match[1], resolved: available.has(match[1] ?? '') }) //
          .toEqual({ tool: name, def: match[1], resolved: true })
      }
    }
  })

  describe('sample conformance for tools no test can call', () => {
    // build_site shells out to a full site build and refresh_cache downloads
    // Scryfall bulk data, so neither is ever invoked from the suite. Their
    // schemas are validated here against the exact body their handler returns,
    // through the same Ajv the SDK uses — otherwise a wrong `required` would ship.
    test('build_site and refresh_cache accept their handlers’ success bodies', async () => {
      const buildSample: BuildSiteResult = {
        message: 'Site built successfully',
        outDir: '/home/user/ritual/dist',
        durationMs: 42_000,
      }
      expect(await validates(BUILD_SITE_OUTPUT, buildSample)).toBe(true)
      expect(await validates(REFRESH_CACHE_OUTPUT, { message: 'Cache refreshed successfully' })) //
        .toBe(true)
      // And reject one missing its required fields.
      expect(await validates(BUILD_SITE_OUTPUT, {})).toBe(false)
      expect(await validates(BUILD_SITE_OUTPUT, { message: 'Site built successfully' })).toBe(false)
      // The localization pair rides beside `message` on every admin-authored
      // response: optional (handlers gain keys incrementally) but accepted, so
      // a widened handler never turns a working tool into an isError result.
      expect(
        await validates(BUILD_SITE_OUTPUT, {
          message: 'Site built successfully',
          messageKey: 'admin.api.buildSite.built',
          messageParams: {},
          outDir: '/tmp/dist',
          durationMs: 12,
        }),
      ).toBe(true)
    })

    test('import_csv accepts a partly-failed import, failure rows and all', async () => {
      // The route is exercised end to end in test/integration/import-csv.test.ts;
      // what only this layer can pin is that the *schema* accepts the body that
      // route returns — including a non-empty `failures`, which is the only thing
      // that exercises the `CsvRowFailure` $def at runtime.
      const sample: Omit<ImportCsvResponse, 'success'> = {
        message: "Imported 2 card(s) into collection 'Binder'; 1 row(s) failed validation",
        cardCount: 2,
        failures: [{ lineNumber: 4, raw: 'Arcane Signet,,', reason: 'Missing set code' }],
        failedCount: 1,
        warnings: ['Skipped header row: name,set,collector_number'],
      }
      expect(await validates(IMPORT_CSV_OUTPUT, sample)).toBe(true)
      // A failure row missing its `reason` is not a report a client can render.
      expect(
        await validates(IMPORT_CSV_OUTPUT, {
          ...sample,
          failures: [{ lineNumber: 4, raw: 'Arcane Signet,,' }],
        }),
      ).toBe(false)
    })

    test('the sync tools accept a representative report', async () => {
      // Typed against the tools' own result types, so a field the schema
      // requires but the report never carries is a compile error here rather
      // than a sample quietly written to match whatever the schema said.
      const deckSample: DeckSyncResult = {
        message: 'Synced 1 deck.',
        // The clause list beside the English sentence: what a client joins and
        // pluralizes in its own language instead of re-parsing the prose.
        summary: {
          clauses: [{ message: 'Synced 1 deck', messageKey: 'admin.api.deckSync.pulled' }],
        },
        report: {
          direction: 'pull',
          decks: [{ name: 'Burn', status: 'synced' }],
          failedCount: 0,
          unreadable: [],
          cancelled: false,
        },
      }
      expect(await validates(SYNC_DECKS_OUTPUT, deckSample)).toBe(true)

      const collectionReport: CollectionSyncReport = {
        direction: 'push',
        into: null,
        dryRun: false,
        lists: [{ name: 'Binder', status: 'synced', added: 1, removed: 0, pending: 0 }],
        failedCount: 0,
        errors: [],
        unreadable: [],
        cancelled: false,
        unresolvedAmbiguity: false,
        ambiguous: [],
        localIncomplete: false,
        csv: null,
        totals: { added: 1, removed: 0, skipped: 0, pending: 0 },
      }
      expect(
        await validates(SYNC_COLLECTION_OUTPUT, {
          message: 'Synced 1 list.',
          summary: {
            clauses: [{ message: 'Synced 1 list', messageKey: 'admin.api.collectionSync.totals' }],
          },
          report: collectionReport,
        }),
      ).toBe(true)
    })
  })

  test('every admin-authored message advertises its localization pair', () => {
    // The response shape the admin API was widened to (plan §7.7): `message`
    // stays rendered English and required — that is what an agent reads and it
    // never moves — while `messageKey`/`messageParams` ride beside it, optional,
    // for a client that renders in the reader's locale. A schema that advertised
    // `message` alone would be a schema a client cannot discover the key from.
    const keyed: JsonSchemaType[] = [
      CREATE_LIST_OUTPUT,
      RENAME_LIST_OUTPUT,
      DELETE_LIST_OUTPUT,
      REWRITE_HISTORY_OUTPUT,
      BUILD_SITE_OUTPUT,
      REFRESH_CACHE_OUTPUT,
      MOVE_SELECTED_CARDS_OUTPUT,
      REMOVE_SELECTED_CARDS_OUTPUT,
      MUTATION_OUTPUT,
      SET_CARD_ART_OUTPUT,
    ]
    for (const schema of keyed) {
      const node = schema as unknown as SchemaNode
      const properties = Object.keys(node.properties ?? {})
      for (const field of ['message', 'messageKey', 'messageParams']) {
        expect(properties).toContain(field)
      }
      // Required English, optional key: the pair is additive, never a new thing
      // a client must handle.
      expect(node.required).toContain('message')
      expect(node.required ?? []).not.toContain('messageKey')
      expect(node.required ?? []).not.toContain('messageParams')
    }

    // A sync run has no single key — its summary is a list of clauses — so the
    // structure rides as `summary` instead, and it is required: a client that
    // never sees it is a client stuck re-parsing English prose.
    for (const schema of [SYNC_DECKS_OUTPUT, SYNC_COLLECTION_OUTPUT]) {
      const node = schema as unknown as SchemaNode
      expect(node.required).toContain('summary')
      const clause = node.properties?.summary?.properties?.clauses?.items
      expect(Object.keys(clause?.properties ?? {})).toEqual([
        'message',
        'messageKey',
        'messageParams',
      ])
      expect(clause?.required).toEqual(['message'])
    }
    // The run-level flags a client branches on are always present, not optional
    // extras: dropping one from `required` is what would turn a real result into
    // a runtime schema failure.
    expect((SYNC_DECKS_OUTPUT as unknown as SchemaNode).properties?.report?.required).toContain(
      'cancelled',
    )
    const collectionReport = (SYNC_COLLECTION_OUTPUT as unknown as SchemaNode).properties?.report
    expect(collectionReport?.required).toContain('cancelled')
    expect(collectionReport?.required).toContain('unresolvedAmbiguity')
  })

  test('the tool-error payload is formalized, though it is never an outputSchema arm', async () => {
    // `isError` results skip output validation entirely, so this shape is
    // documented and pinned rather than attached to every tool. Built by the
    // real producer rather than a literal, so a change to how a conflict is
    // classified shows up here.
    expect(
      await validates(
        TOOL_ERROR_OUTPUT,
        toToolErrorPayload(apiErrorToMcp(409, { message: 'modified' })),
      ),
    ).toBe(true)
    expect(await validates(TOOL_ERROR_OUTPUT, { error: true, code: 'nope', message: 'x' })).toBe(
      false,
    )
  })
})
