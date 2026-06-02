import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isListType } from '../list-type'
import { callApi } from './dispatch'
import { apiErrorToMcp } from './errors'
import type { ListsResponse } from './types'

/** Map a list type + slug to the admin load endpoint that backs its resource read. */
function endpointFor(type: string, slug: string): string {
  const encoded = encodeURIComponent(slug)
  if (type === 'deck') return `/api/deck/${encoded}`
  if (type === 'collection') return `/api/collection/${encoded}`
  return `/api/wanted/${encoded}`
}

/** Template variables arrive as string | string[]; take the first concrete value. */
function firstValue(value: string | string[] | undefined): string {
  if (value === undefined) return ''
  return Array.isArray(value) ? (value[0] ?? '') : value
}

/**
 * Expose every deck, collection, and wanted list as a readable MCP resource at
 * `ritual://{type}/{slug}`. The `list` callback enumerates them via GET /api/history;
 * a read dispatches to the matching load endpoint and returns the JSON payload.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    'ritual-list',
    new ResourceTemplate('ritual://{type}/{slug}', {
      list: async () => {
        const data = (await callApi('GET', '/api/history')) as ListsResponse
        return {
          resources: data.lists.map((entry) => ({
            uri: `ritual://${entry.type}/${entry.slug}`,
            name: entry.name,
            description: `${entry.type}: ${entry.name}`,
            mimeType: 'application/json',
          })),
        }
      },
    }),
    {
      title: 'Ritual list',
      description: 'A deck, collection, or wanted list, addressed as ritual://{type}/{slug}.',
    },
    async (uri, variables) => {
      const type = firstValue(variables.type)
      const slug = firstValue(variables.slug)
      if (!isListType(type)) {
        throw apiErrorToMcp(400, { message: `Unknown list type "${type}" in ${uri.href}` })
      }
      const data = await callApi('GET', endpointFor(type, slug))
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    },
  )
}
