import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { version } from '../version'
import { registerResources } from './resources'
import { registerDestructiveTools } from './tools/destructive-tools'
import { registerReadTools } from './tools/read-tools'
import { registerWriteTools } from './tools/write-tools'

const INSTRUCTIONS = `Ritual manages Magic: The Gathering decks, collections, and wanted lists stored as markdown files.

- Inspect with the list_* and load_* tools. list_all_lists maps display names to their { type, slug }.
- Lists are addressed by slug (the file basename without ".md").
- Edit cards with add_card_to_*, remove_card_from_deck, set_card_note, set_card_printing, and set_commander.
  Content hashes for conflict detection are handled internally — you do not supply them.
- import_deck imports a decklist from a URL or pasted text; import_csv imports CSV text into a new
  or existing list of any type (create/overwrite/append, with a column-mapping spec).
- import_changes applies a change bundle exported from the site editor ("ritual-change-bundle"
  JSON covering one or more lists) to the underlying lists.
- move_cards moves cards between lists using opaque keys from move_candidates.
- export_cards renders a CSV/JSON export of any mix of lists and card picks (filterable by name,
  set, finish, condition; column selection and order included) and returns the content string.
- rename_*, delete_* (which require a matching confirmName), rewrite_history, and update_config are
  destructive; use them deliberately.
- Lists are also exposed as readable resources at ritual://{type}/{slug}.`

/** Build the Ritual MCP server with all tools and resources registered (transport-agnostic). */
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'ritual', version },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  )
  registerReadTools(server)
  registerWriteTools(server)
  registerDestructiveTools(server)
  registerResources(server)
  return server
}
