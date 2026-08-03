import { McpServer } from '@modelcontextprotocol/server'
import { version } from '../version'
import { NEVER_CACHE, STATIC_CATALOG_CACHE } from './cache-hints'
import { createListChangeNotifier } from './notify'
import { registerResources } from './resources'
import { registerDestructiveTools } from './tools/destructive-tools'
import { registerReadTools } from './tools/read-tools'
import { registerWriteTools } from './tools/write-tools'

/**
 * Cross-tool invariants only.
 *
 * Anything a single tool's description already says is left to that description:
 * these instructions are served on every session, so restating per-tool prose
 * here pays for it twice. What stays is what no one description can say.
 */
const INSTRUCTIONS = `Ritual manages Magic: The Gathering decks, collections, and wanted lists stored as markdown files.

- Lists are addressed by listType ("deck" | "collection" | "wanted") + slug (the file basename
  without ".md"). list_lists enumerates; get_list reads (start with view "summary" on an unfamiliar
  list). Lists are also readable resources at ritual://{type}/{slug}.
- Card targeting is exact and case-sensitive; cardId (the &N id get_list shows) wins when present,
  so pair it only with a cardName from the same get_list snapshot (ids are recycled after removals).
- Single-list edits are all-or-nothing; the cross-list batch tools and import_change_bundle skip
  and report instead.
- Every tool returns structuredContent against its declared outputSchema; read that, not
  content[0].text. A failure is isError with { error, code, message, conflict?, recovery?,
  unmatched? } — code is "conflict" | "invalid-request" | "internal".
- Card names on writes are validated against the local cache; an unknown one is rejected with the
  closest cached names, and a cold cache says to run refresh_cache.
- Network vs local, by name: search_scryfall queries Scryfall; find_cards and autocomplete_card
  read your lists and your local cache.`

/** How a transport wants the server built. */
export interface McpServerOptions {
  /**
   * Advertise `resources.listChanged` and emit the notification from the tools
   * that create, rename, or delete a list. Only true on a transport that keeps
   * one server instance per connection — stdio does, the stateless HTTP leg
   * does not.
   */
  notifyListChanged?: boolean
}

/** Build the Ritual MCP server with all tools and resources registered (transport-agnostic). */
export function buildMcpServer(options: McpServerOptions = {}): McpServer {
  const notifyListChanged = options.notifyListChanged === true
  const server = new McpServer(
    { name: 'ritual', version },
    {
      // The SDK defaults declared capabilities to `listChanged: true`. Ritual's
      // tool catalogue is fixed per binary and it supports no subscriptions, so
      // advertising either would be a lie. `resources.listChanged` is true only
      // on a transport that can actually deliver the notification.
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: notifyListChanged, subscribe: false },
      },
      instructions: INSTRUCTIONS,
      // See cache-hints.ts for the policy rationale. `server/discover` is as
      // fixed per binary as the tool catalog, so it shares the long TTL.
      cacheHints: {
        'tools/list': STATIC_CATALOG_CACHE,
        'resources/templates/list': STATIC_CATALOG_CACHE,
        'server/discover': STATIC_CATALOG_CACHE,
        'resources/list': NEVER_CACHE,
        'resources/read': NEVER_CACHE,
      },
    },
  )
  const notifier = createListChangeNotifier(server, notifyListChanged)
  registerReadTools(server)
  registerWriteTools(server, notifier)
  registerDestructiveTools(server, notifier)
  registerResources(server)
  return server
}
