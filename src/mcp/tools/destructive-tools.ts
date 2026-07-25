import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callApi } from '../dispatch'
import { jsonResult } from '../result'
import { listTypeSchema, slugField } from '../schemas'
import { SYNC_DIRECTIONS } from '../../deck-sync/engine'

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
})

/**
 * Register the destructive / administrative tools. rename_list changes a list’s
 * file and slug; delete_list requires a matching `confirmName`; rewrite_history
 * replaces a change log wholesale; update_config persists configuration;
 * build_site, sync_decks, and refresh_cache trigger longer-running operations
 * (sync_decks also writes to Archidekt). All are flagged with the SDK’s
 * destructiveHint so clients can gate or confirm them.
 */
export function registerDestructiveTools(server: McpServer): void {
  server.registerTool(
    'rename_list',
    {
      title: 'Rename list',
      description: 'Rename a deck, collection, or wanted list (changes its display name and slug).',
      inputSchema: { listType: listTypeSchema, slug: slugField, newName: newNameField },
      annotations: { destructiveHint: true },
    },
    async ({ listType, slug, newName }) =>
      jsonResult(
        await callApi('POST', `/api/${listType}/${encodeURIComponent(slug)}/rename`, { newName }),
      ),
  )

  server.registerTool(
    'delete_list',
    {
      title: 'Delete list',
      description:
        'Delete a deck, collection, or wanted list. confirmName must match its display name.',
      inputSchema: { listType: listTypeSchema, slug: slugField, confirmName: confirmNameField },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ listType, slug, confirmName }) =>
      jsonResult(
        await callApi('DELETE', `/api/${listType}/${encodeURIComponent(slug)}`, { confirmName }),
      ),
  )

  server.registerTool(
    'rewrite_history',
    {
      title: 'Rewrite change history',
      description:
        'Replace a list’s entire change log with the supplied sets (newest or oldest order is ' +
        'preserved as given). Only the .changes.md file is rewritten; the list itself is untouched.',
      inputSchema: {
        listType: listTypeSchema,
        slug: slugField,
        sets: z.array(changeSetSchema).describe('The full set of change sets to write.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ listType, slug, sets }) =>
      jsonResult(
        await callApi('POST', `/api/history/${listType}/${encodeURIComponent(slug)}/save`, {
          sets,
        }),
      ),
  )

  server.registerTool(
    'update_config',
    {
      title: 'Update config',
      description:
        'Merge a partial Ritual configuration into the current one (e.g. admin git settings, ' +
        'or site.bannedPrintings — "SET:COLLECTOR" printings barred from auto-selection as a ' +
        'card\'s default printing). Nested "admin" fields merge; other top-level keys replace. ' +
        'Unknown keys — top-level or nested in "admin" — are rejected.',
      inputSchema: {
        config: z.record(z.string(), z.unknown()).describe('Partial RitualConfig object to merge.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ config }) => jsonResult(await callApi('PUT', '/api/config', config)),
  )

  server.registerTool(
    'build_site',
    {
      title: 'Build site',
      description: 'Rebuild the public static site from the current lists.',
      inputSchema: {},
      annotations: { destructiveHint: true },
    },
    async () => jsonResult(await callApi('POST', '/api/build-site')),
  )

  server.registerTool(
    'sync_decks',
    {
      title: 'Sync decks with Archidekt',
      description:
        'Sync Archidekt-linked decks: "pull" applies remote changes to the local deck files ' +
        '(recording them in each changelog), "push" sends local changes to decks you own on ' +
        'Archidekt. Omit decks to sync every linked deck. Returns a per-deck report; ' +
        'a run with failures still reports success — check report.failedCount.',
      inputSchema: {
        direction: z
          .enum(SYNC_DIRECTIONS)
          .describe('"pull" (Archidekt → local) or "push" (local → Archidekt).'),
        decks: z
          .array(z.string().min(1))
          .optional()
          .describe('Deck slugs or names; omit to sync every Archidekt-linked deck.'),
        dryRun: z
          .boolean()
          .optional()
          .describe('Report what would sync without writing files or pushing changes.'),
        ignoreUnreadableLines: z
          .boolean()
          .optional()
          .describe(
            'Sync decks whose files contain lines the parser cannot read, deleting those lines. ' +
              'Such decks fail by default; check the failure reason and confirm with the user ' +
              'before setting this.',
          ),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async ({ direction, decks, dryRun, ignoreUnreadableLines }) =>
      jsonResult(
        await callApi('POST', '/api/deck-sync', {
          direction,
          decks,
          dryRun,
          ignoreUnreadableLines,
        }),
      ),
  )

  server.registerTool(
    'refresh_cache',
    {
      title: 'Refresh card cache',
      description:
        'Refresh the local Scryfall card cache (downloads bulk card data and oracle/art tags; may take a while).',
      inputSchema: {},
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async () => jsonResult(await callApi('POST', '/api/cache/refresh')),
  )
}
