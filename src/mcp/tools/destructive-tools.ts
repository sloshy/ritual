import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callApi } from '../dispatch'
import { jsonResult } from '../result'
import { listTypeSchema, slugField } from '../schemas'

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
 * Register the destructive / administrative tools. Renames change a list’s file
 * and slug; deletes require a matching `confirmName`; rewrite_history replaces a
 * change log wholesale; update_config persists configuration; build_site and
 * refresh_cache trigger longer-running operations. All are flagged with the SDK’s
 * destructiveHint so clients can gate or confirm them.
 */
export function registerDestructiveTools(server: McpServer): void {
  server.registerTool(
    'rename_deck',
    {
      title: 'Rename deck',
      description: 'Rename a deck (changes its display name and slug).',
      inputSchema: { slug: slugField, newName: newNameField },
      annotations: { destructiveHint: true },
    },
    async ({ slug, newName }) =>
      jsonResult(
        await callApi('POST', `/api/deck/${encodeURIComponent(slug)}/rename`, { newName }),
      ),
  )

  server.registerTool(
    'rename_collection',
    {
      title: 'Rename collection',
      description: 'Rename a collection (changes its display name and slug).',
      inputSchema: { slug: slugField, newName: newNameField },
      annotations: { destructiveHint: true },
    },
    async ({ slug, newName }) =>
      jsonResult(
        await callApi('POST', `/api/collection/${encodeURIComponent(slug)}/rename`, { newName }),
      ),
  )

  server.registerTool(
    'rename_wanted',
    {
      title: 'Rename wanted list',
      description: 'Rename a wanted list (changes its display name and slug).',
      inputSchema: { slug: slugField, newName: newNameField },
      annotations: { destructiveHint: true },
    },
    async ({ slug, newName }) =>
      jsonResult(
        await callApi('POST', `/api/wanted/${encodeURIComponent(slug)}/rename`, { newName }),
      ),
  )

  server.registerTool(
    'delete_deck',
    {
      title: 'Delete deck',
      description: 'Delete a deck. confirmName must match the deck’s display name.',
      inputSchema: { slug: slugField, confirmName: confirmNameField },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, confirmName }) =>
      jsonResult(await callApi('DELETE', `/api/deck/${encodeURIComponent(slug)}`, { confirmName })),
  )

  server.registerTool(
    'delete_collection',
    {
      title: 'Delete collection',
      description: 'Delete a collection. confirmName must match the collection’s display name.',
      inputSchema: { slug: slugField, confirmName: confirmNameField },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, confirmName }) =>
      jsonResult(
        await callApi('DELETE', `/api/collection/${encodeURIComponent(slug)}`, { confirmName }),
      ),
  )

  server.registerTool(
    'delete_wanted',
    {
      title: 'Delete wanted list',
      description: 'Delete a wanted list. confirmName must match the wanted list’s display name.',
      inputSchema: { slug: slugField, confirmName: confirmNameField },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ slug, confirmName }) =>
      jsonResult(
        await callApi('DELETE', `/api/wanted/${encodeURIComponent(slug)}`, { confirmName }),
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
        type: listTypeSchema,
        slug: slugField,
        sets: z.array(changeSetSchema).describe('The full set of change sets to write.'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ type, slug, sets }) =>
      jsonResult(
        await callApi('POST', `/api/history/${type}/${encodeURIComponent(slug)}/save`, { sets }),
      ),
  )

  server.registerTool(
    'update_config',
    {
      title: 'Update config',
      description:
        'Merge a partial Ritual configuration into the current one (e.g. admin git settings). ' +
        'Nested "admin" fields merge; other top-level keys replace.',
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
    'refresh_cache',
    {
      title: 'Refresh card cache',
      description: 'Refresh the local Scryfall card cache (downloads bulk data; may take a while).',
      inputSchema: {},
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async () => jsonResult(await callApi('POST', '/api/cache/refresh')),
  )
}
