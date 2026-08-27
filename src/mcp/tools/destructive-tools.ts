import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { BuildSiteResponse } from '../../admin/api/build-site'
import type { CacheRefreshResponse } from '../../admin/api/cache'
import type { SellRefreshResponse } from '../../admin/api/sell'
import type {
  CollectionSyncRequest,
  CollectionSyncRunResponse,
} from '../../admin/api/collection-sync'
import type { ConfigResponse } from '../../admin/api/config'
import type { DeckSyncRequest, DeckSyncRunResponse } from '../../admin/api/deck-sync'
import type { HistorySaveResponse } from '../../admin/api/history'
import type { ListDeleteResponse, ListRenameResponse } from '../../admin/api/list-lifecycle'
import { callApi, callApiData } from '../dispatch'
import { createToolProgressSink } from '../progress'
import type { ListChangeNotifier } from '../notify'
import { outputSchemaFor, runTool } from '../result'
import { listTypeSchema, slugField } from '../schemas'
import type { OmitSuccess, UpdateConfigResult } from '../types'
import { CSV_UPLOAD_THRESHOLD } from '../../collection-sync/csv'
import { SYNC_CHANGE_FILTERS, SYNC_DIRECTIONS } from '../../sync/common'

/** `rename_list` result: the slug the list moved to. */
export type RenameListResult = OmitSuccess<ListRenameResponse>

/** `delete_list` result: the list is gone. */
export type DeleteListResult = OmitSuccess<ListDeleteResponse>

/** `rewrite_history` result: how many change sets were written. */
export type HistoryRewriteResult = OmitSuccess<HistorySaveResponse>

/** `build_site` result. */
export type BuildSiteResult = OmitSuccess<BuildSiteResponse>

/** `refresh_cache` result. */
export type CacheRefreshResult = OmitSuccess<CacheRefreshResponse>

/** `refresh_buylist` result. */
export type BuylistRefreshResult = OmitSuccess<SellRefreshResponse>

/** The success arm of a sync run — `callApi` throws on the failure arm. */
type SyncRunSuccess<T> = Extract<T, { success: true }>

/** `sync_decks` result: the run's per-deck report. */
export type DeckSyncResult = OmitSuccess<SyncRunSuccess<DeckSyncRunResponse>>

/** `sync_collection` result: the run's per-list report. */
export type CollectionSyncResult = OmitSuccess<SyncRunSuccess<CollectionSyncRunResponse>>

const newNameField = z.string().min(1).describe('New display name.')
const confirmNameField = z
  .string()
  .min(1)
  .describe(
    'Must exactly match the list’s current display name (its "# Title"), or the call fails.',
  )

const changeSetSchema = z.object({
  timestamp: z.string().describe('ISO-8601 timestamp for the change set.'),
  lines: z
    .array(z.string())
    .min(1)
    .describe('Change lines, each starting with "- " (e.g. "- Added Sol Ring").'),
  trailing: z
    .array(z.string())
    .optional()
    .describe(
      'Hand-written non-change lines to preserve after this set’s change lines (must not start with "- " or "## ").',
    ),
})

// ── Wording shared by the two Archidekt sync tools ────────────────────
//
// sync_decks and sync_collection expose the same flags over the same
// vocabulary, so the prose describing them lives here once, parameterized by
// what each tool syncs. Only the descriptions are shared: the fields themselves
// are built per tool, since a tool’s raw input shape is its own.

const SYNC_DIRECTION_DESCRIPTION = '"pull" (Archidekt → local) or "push" (local → Archidekt).'

const SYNC_DRY_RUN_DESCRIPTION = 'Report what would sync without writing files or pushing changes.'

/**
 * The `only` filter, worded for the thing whose diff it narrows (`"each deck"`,
 * `"the collection"`).
 */
function changeFilterDescription(subject: string): string {
  return (
    `Apply only one side of ${subject}’s diff, relative to the sync destination: ` +
    '"additions" applies new cards and quantity increases, "removals" applies ' +
    'removed cards and quantity decreases. Omit to apply every change.'
  )
}

/**
 * The `ignoreUnreadableLines` escape hatch, worded for what fails without it
 * (`"decks"`, `"collection lists"`). Both directions lose those lines — a pull
 * rewrites the file, and a push treats the file as the truth — which is why this
 * is the tool’s stand-in for the CLI’s `--yes` prompt.
 */
function ignoreUnreadableDescription(plural: string): string {
  return (
    `Sync ${plural} whose files contain lines the parser cannot read, losing those lines. ` +
    `Such ${plural} fail by default; check the failure reason and confirm with the user ` +
    'before setting this.'
  )
}

/**
 * Register the destructive / administrative tools. rename_list changes a list’s
 * file and slug; delete_list requires a matching `confirmName`; rewrite_history
 * replaces a change log wholesale; update_config persists configuration;
 * build_site, sync_decks, sync_collection, refresh_cache, and refresh_buylist
 * trigger longer-running operations (both sync tools also write to Archidekt).
 * All are flagged with the SDK’s destructiveHint so clients can gate or confirm
 * them.
 */
export function registerDestructiveTools(server: McpServer, notifier: ListChangeNotifier): void {
  server.registerTool(
    'rename_list',
    {
      title: 'Rename list',
      description:
        'Rename a deck, collection, or wanted list (changes its display name, slug, and file ' +
        'path). Refused when another list of that type already resolves under the new name; ' +
        'changing only the capitalization or punctuation of this list’s own name is allowed.',
      inputSchema: z.object({ listType: listTypeSchema, slug: slugField, newName: newNameField }),
      outputSchema: outputSchemaFor<RenameListResult>('rename_list'),
      annotations: { destructiveHint: true },
    },
    async ({ listType, slug, newName }) =>
      runTool(async (): Promise<RenameListResult> => {
        const data = await callApiData<ListRenameResponse>(
          'POST',
          `/api/${listType}/${encodeURIComponent(slug)}/rename`,
          { newName },
        )
        notifier.notifyListsChanged()
        return data
      }),
  )

  server.registerTool(
    'delete_list',
    {
      title: 'Delete list',
      description:
        'Delete a deck, collection, or wanted list and every sidecar it has. confirmName must ' +
        'match its display name exactly; the deleted paths come back in deletedFiles.',
      inputSchema: z.object({
        listType: listTypeSchema,
        slug: slugField,
        confirmName: confirmNameField,
      }),
      outputSchema: outputSchemaFor<DeleteListResult>('delete_list'),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ listType, slug, confirmName }) =>
      runTool(async (): Promise<DeleteListResult> => {
        const data = await callApiData<ListDeleteResponse>(
          'DELETE',
          `/api/${listType}/${encodeURIComponent(slug)}`,
          { confirmName },
        )
        notifier.notifyListsChanged()
        return data
      }),
  )

  server.registerTool(
    'rewrite_history',
    {
      title: 'Rewrite change history',
      description:
        'Replace a list’s entire change log with the supplied sets (newest or oldest order is ' +
        'preserved as given). Only the .changes.md file is rewritten; the list itself is untouched. ' +
        'Sets you did not author should be echoed back exactly as get_history returned them — ' +
        'including each set’s `trailing` array — or the hand-written text it holds is deleted.',
      inputSchema: z.object({
        listType: listTypeSchema,
        slug: slugField,
        sets: z.array(changeSetSchema).describe('The full set of change sets to write.'),
      }),
      outputSchema: outputSchemaFor<HistoryRewriteResult>('rewrite_history'),
      annotations: { destructiveHint: true },
    },
    async ({ listType, slug, sets }) =>
      runTool(async (): Promise<HistoryRewriteResult> => {
        const data = await callApiData<HistorySaveResponse>(
          'POST',
          `/api/history/${listType}/${encodeURIComponent(slug)}/save`,
          { sets },
        )
        return data
      }),
  )

  server.registerTool(
    'update_config',
    {
      title: 'Update config',
      description:
        'Merge a partial Ritual configuration into the current one (e.g. admin git settings, ' +
        'defaultLanguage — the canonical Scryfall code stamped on newly added cards, whose ' +
        'non-"en" values switch cache downloads to the much larger all-cards bulk — ' +
        'uiLocale — the unrelated interface language, a BCP-47 tag such as "de-AT" with no ' +
        'download cost; do not reach for defaultLanguage when the user asks to change the ' +
        'interface language — site.bannedPrintings — "SET:COLLECTOR" printings barred from auto-selection as a ' +
        "card's default printing — or priceSources — which stores the sites offer prices from " +
        '(any of "tcgplayer", "cardmarket", "cardkingdom"; [] hides all site prices; enabling ' +
        'cardkingdom makes builds/servers download the Card Kingdom feed like sell mode does). ' +
        'Nested "admin" fields merge; other top-level keys replace. ' +
        'Unknown keys — top-level or nested in "admin" — are rejected. Writing a key a session ' +
        'flag overrides (get_config reports these under overrides) persists the value but does ' +
        'not change what this running server operates with — e.g. under --sell-mode, sell mode ' +
        'stays on whatever site.sellMode you store.',
      inputSchema: z.object({
        config: z.record(z.string(), z.unknown()).describe('Partial RitualConfig object to merge.'),
      }),
      outputSchema: outputSchemaFor<UpdateConfigResult>('update_config'),
      annotations: { destructiveHint: true },
    },
    async ({ config }) =>
      runTool(async (): Promise<UpdateConfigResult> => {
        const data = (await callApi('PUT', '/api/config', config)) as ConfigResponse
        return { config: data.config }
      }),
  )

  server.registerTool(
    'build_site',
    {
      title: 'Build site',
      description:
        'Rebuild the public static site from the current lists. Runs asynchronously in a child ' +
        'process and publishes atomically, so an interrupted build never leaves a broken site. ' +
        'Emits progress notifications when the call supplies a progressToken, and honours ' +
        'cancellation.',
      inputSchema: z.object({}),
      outputSchema: outputSchemaFor<BuildSiteResult>('build_site'),
      annotations: { destructiveHint: true },
    },
    async (_args, ctx) =>
      runTool(async (): Promise<BuildSiteResult> => {
        const data = await callApiData<BuildSiteResponse>('POST', '/api/build-site', undefined, {
          onProgress: createToolProgressSink(ctx),
          signal: ctx.mcpReq.signal,
        })
        return data
      }),
  )

  server.registerTool(
    'sync_decks',
    {
      title: 'Sync decks with Archidekt',
      description:
        'Sync Archidekt-linked decks: "pull" applies remote changes to the local deck files ' +
        '(recording them in each changelog), "push" sends local changes to decks you own on ' +
        'Archidekt. Omit decks to sync every linked deck. A push whose remote deck changed ' +
        'since that deck’s recorded lastSynced fails rather than reverting those remote edits ' +
        '— pull first, or pass force: true to overwrite them. Returns a per-deck report; ' +
        'a run with failures still reports success — check report.failedCount. ' +
        'Emits one progress notification per deck when the call supplies a progressToken.',
      inputSchema: z.object({
        direction: z.enum(SYNC_DIRECTIONS).describe(SYNC_DIRECTION_DESCRIPTION),
        decks: z
          .array(z.string().min(1))
          .optional()
          .describe('Deck slugs or names; omit to sync every Archidekt-linked deck.'),
        dryRun: z.boolean().optional().describe(SYNC_DRY_RUN_DESCRIPTION),
        ignoreUnreadableLines: z
          .boolean()
          .optional()
          .describe(ignoreUnreadableDescription('decks')),
        only: z.enum(SYNC_CHANGE_FILTERS).optional().describe(changeFilterDescription('each deck')),
        force: z
          .boolean()
          .optional()
          .describe(
            'Push a deck whose remote copy changed since the remote updatedAt its last sync ' +
              'recorded (sourceUpdatedAt), overwriting those remote changes. Without it such a ' +
              'deck fails; a pull of that deck records the new baseline — even when it finds no ' +
              'card changes — after which the push succeeds. Ignored on a pull.',
          ),
        syncPrintings: z
          .boolean()
          .optional()
          .describe(
            'Also sync each card’s exact printing — set, collector number, and foil/etched ' +
              'finish (the CLI’s --sync-printings). Off by default, the diff compares names and ' +
              'quantities only. With it, a card held at several printings at once is reconciled ' +
              'printing by printing: copies are added, removed, or re-pinned so both sides hold ' +
              'the same printings in the same quantities. A local line naming no printing pushes ' +
              'nothing; a stated finish the printing does not offer on Archidekt fails that ' +
              'deck. The "only" filter does not apply to printing updates. Each deck’s report ' +
              'entry then carries printingsChanged; without the flag, a deck whose printings ' +
              'disagree between the two sides carries printingsUnaligned instead and its ' +
              'printings are left alone.',
          ),
      }),
      outputSchema: outputSchemaFor<DeckSyncResult>('sync_decks'),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async (
      { direction, decks, dryRun, ignoreUnreadableLines, only, force, syncPrintings },
      ctx,
    ) => {
      // Typed against the endpoint's own contract, so a field renamed on either
      // side is a compile error here rather than an option silently dropped on
      // the way to the handler (which ignores keys it does not know) — the same
      // reason `sync_collection` below builds its body this way.
      const body: Partial<DeckSyncRequest> = {
        direction,
        decks,
        dryRun,
        ignoreUnreadableLines,
        only,
        force,
        syncPrintings,
      }
      return runTool(async (): Promise<DeckSyncResult> => {
        const data = await callApiData<SyncRunSuccess<DeckSyncRunResponse>>(
          'POST',
          '/api/deck-sync',
          body,
          {
            onProgress: createToolProgressSink(ctx),
          },
        )
        return data
      })
    },
  )

  server.registerTool(
    'sync_collection',
    {
      title: 'Sync collection with Archidekt',
      description:
        'Sync collection lists with the signed-in Archidekt account’s collection: "pull" adds ' +
        'and removes local card lines (recording them in each changelog), "push" reshapes the ' +
        'remote records to match the local lists. An account has ONE collection while Ritual ' +
        'has many collection lists, so a run compares the union of the lists in scope against ' +
        'the whole remote collection. A pull that must take only SOME of a printing’s copies ' +
        'when they live in several lists cannot know which list lost the card: without ' +
        'removalPriority such a run fails and writes nothing at all — not even the account’s ' +
        'lastSynced. report.ambiguous lists every ambiguity the planner found whether or not a ' +
        'priority went on to place them, so read report.errors to tell a failed run from a ' +
        `resolved one. A push adding more than ${CSV_UPLOAD_THRESHOLD} new printings likewise ` +
        'fails without pushing anything unless csv: true lets it upload them as one CSV import ' +
        '(report.csv then says what that import did). Returns a per-list report; a run with ' +
        'failures still reports success — check report.failedCount. Emits one progress ' +
        'notification per list when the call supplies a progressToken.',
      inputSchema: z.object({
        direction: z.enum(SYNC_DIRECTIONS).describe(SYNC_DIRECTION_DESCRIPTION),
        lists: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Collection list slugs or names to scope the local side to; omit to compare every ' +
              'collection list. The remote side is always the whole Archidekt collection, so ' +
              'naming a subset declares that those lists are what it mirrors — cards living ' +
              'only in unnamed lists read as absent. Pair it with only: "additions" when the ' +
              'named lists are not the whole story.',
          ),
        dryRun: z.boolean().optional().describe(SYNC_DRY_RUN_DESCRIPTION),
        ignoreUnreadableLines: z
          .boolean()
          .optional()
          .describe(ignoreUnreadableDescription('collection lists')),
        only: z
          .enum(SYNC_CHANGE_FILTERS)
          .optional()
          .describe(changeFilterDescription('the collection')),
        into: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Collection list a pull adds new cards to, created if it does not exist. A name TWO ' +
              'lists answer to fails the run before anything is fetched or written. Defaults ' +
              'to the collectionSync.pullTarget config key ("Inbox" unless configured). A push ' +
              'ignores it — it writes nothing locally.',
          ),
        removalPriority: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Collection lists an ambiguous removal may take copies from, IN PRIORITY ORDER: ' +
              'copies come only from these lists, walking them in the order given. Names are ' +
              'matched exactly (never by the substring rule), and an unknown one fails the run. ' +
              'It applies to ambiguous removals only — taking every copy of a printing, or ' +
              'copies held in a single list, never needs it. A priority that cannot cover a ' +
              'removal fails the run and writes nothing, so ask the user which binders may ' +
              'lose cards rather than guessing. A push ignores it.',
          ),
        csv: z
          .boolean()
          .optional()
          .describe(
            'Send a push’s NEW cards to Archidekt as one CSV import (rows built from the local ' +
              'Scryfall cache) instead of resolving and creating them one at a time. Adding a ' +
              `printing costs a search plus a create, so a push with more than ${CSV_UPLOAD_THRESHOLD} ` +
              'new printings and no csv: true FAILS before writing anything remote rather than ' +
              'spending that many paced requests — there is nobody to prompt over MCP. Set it for ' +
              'any large push (a dry run never needs it: it reports the upload it would make). ' +
              'The rows come from the local Scryfall cache, so an empty or day-old cache is ' +
              'refreshed automatically before the upload is built (there is nobody to ask). ' +
              'report.csv then says what the import did, including rows Archidekt refused. ' +
              'Quantity changes and removals never ride the CSV, and a pull ignores the field. ' +
              'Writing the CSV to a file instead of pushing it is CLI-only (--csv-file).',
          ),
      }),
      outputSchema: outputSchemaFor<CollectionSyncResult>('sync_collection'),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async (
      { direction, lists, dryRun, ignoreUnreadableLines, only, into, removalPriority, csv },
      ctx,
    ) => {
      // Typed against the endpoint's own contract, so a field renamed on either
      // side is a compile error here rather than an option silently dropped on the
      // way to the handler (which ignores keys it does not know).
      const body: Partial<CollectionSyncRequest> = {
        direction,
        lists,
        dryRun,
        ignoreUnreadableLines,
        only,
        into,
        removalPriority,
        csv,
      }
      return runTool(async (): Promise<CollectionSyncResult> => {
        const data = await callApiData<SyncRunSuccess<CollectionSyncRunResponse>>(
          'POST',
          '/api/collection-sync',
          body,
          { onProgress: createToolProgressSink(ctx) },
        )
        return data
      })
    },
  )

  server.registerTool(
    'refresh_cache',
    {
      title: 'Refresh card cache',
      description:
        'Refresh the local Scryfall card cache (downloads bulk card data and oracle/art tags; ' +
        'may take a while). Fails with an error when the download or ingest fails — it no longer ' +
        'reports success unconditionally. Emits progress notifications when the call supplies a ' +
        'progressToken.',
      inputSchema: z.object({}),
      outputSchema: outputSchemaFor<CacheRefreshResult>('refresh_cache'),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async (_args, ctx) =>
      runTool(async (): Promise<CacheRefreshResult> => {
        const data = await callApiData<CacheRefreshResponse>(
          'POST',
          '/api/cache/refresh',
          undefined,
          { onProgress: createToolProgressSink(ctx) },
        )
        return data
      }),
  )

  server.registerTool(
    'refresh_buylist',
    {
      title: 'Refresh Card Kingdom buylist',
      description:
        'Download the Card Kingdom pricelist feed (~70 MB) when the cached copy is stale ' +
        '(older than a day) or missing; force redownloads regardless. get_sell_report reads ' +
        'strictly from this cache, so run this first when it errors or looks out of date. ' +
        'Requires sell mode: with the site.sellMode config off and no --sell-mode flag on ' +
        'this server, this tool errors "Not found". refresh_cache never refreshes the ' +
        'buylist — only this tool and `ritual cache preload-all` do.',
      inputSchema: z.object({
        force: z
          .boolean()
          .optional()
          .describe('Redownload even when the cached feed is still fresh.'),
      }),
      outputSchema: outputSchemaFor<BuylistRefreshResult>('refresh_buylist'),
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ force }) =>
      runTool(async (): Promise<BuylistRefreshResult> => {
        const data = await callApiData<SellRefreshResponse>(
          'POST',
          `/api/sell/refresh${force === true ? '?force=true' : ''}`,
        )
        return data
      }),
  )
}
