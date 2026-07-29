import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/server'
import { isListType, LIST_TYPES } from '../list-type'
import { NEVER_CACHE } from './cache-hints'
import { callApi } from './dispatch'
import { apiErrorToMcp } from './errors'
import { loadProjectedList } from './projection'
import type { ListsResponse } from './types'

/** Template variables arrive as string | string[]; take the first concrete value. */
function firstValue(value: string | string[] | undefined): string {
  if (value === undefined) return ''
  return Array.isArray(value) ? (value[0] ?? '') : value
}

/**
 * Expose every deck, collection, and wanted list as a readable MCP resource at
 * `ritual://{type}/{slug}`. The `list` callback enumerates them via GET /api/lists;
 * a read returns the same agent-facing projection as the `get_list` tool (see
 * {@link loadProjectedList}) — never the raw editor payload. The `complete`
 * callbacks let a client offer the real types and slugs while a URI is being
 * typed, so a resource reference never has to be guessed.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    'ritual-list',
    new ResourceTemplate('ritual://{type}/{slug}', {
      list: async () => {
        const data = (await callApi('GET', '/api/lists')) as ListsResponse
        return {
          resources: data.lists.map((entry) => ({
            uri: `ritual://${entry.type}/${entry.slug}`,
            name: entry.name,
            description: `${entry.type}: ${entry.name}`,
            mimeType: 'application/json',
          })),
        }
      },
      complete: {
        type: (value) => LIST_TYPES.filter((type) => type.startsWith(value)),
        slug: async (value, context) => {
          const data = (await callApi('GET', '/api/lists')) as ListsResponse
          // The SDK passes the arguments already filled in, so a `type` the user
          // has chosen narrows the slugs rather than offering every list's.
          const type = context?.arguments?.type
          return data.lists
            .filter(
              (entry) =>
                (type === undefined || entry.type === type) && entry.slug.startsWith(value),
            )
            .map((entry) => entry.slug)
        },
      },
    }),
    {
      title: 'Ritual list',
      description: 'A deck, collection, or wanted list, addressed as ritual://{type}/{slug}.',
      // List contents change on every edit, so a read is never cacheable.
      cacheHint: NEVER_CACHE,
    },
    async (uri, variables) => {
      const type = firstValue(variables.type)
      const slug = firstValue(variables.slug)
      if (!isListType(type)) {
        throw apiErrorToMcp(400, { message: `Unknown list type "${type}" in ${uri.href}` })
      }
      const data = await loadProjectedList(type, slug)
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    },
  )
}
