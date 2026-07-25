import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { version } from '../version'
import { registerResources } from './resources'
import { registerDestructiveTools } from './tools/destructive-tools'
import { registerReadTools } from './tools/read-tools'
import { registerWriteTools } from './tools/write-tools'

const INSTRUCTIONS = `Ritual manages Magic: The Gathering decks, collections, and wanted lists stored as markdown files.

- Every list is addressed by listType ("deck" | "collection" | "wanted") plus slug (the file
  basename without ".md"). list_lists enumerates them (optionally filtered by listType); load_list
  reads one — decks return { slug, deck, frontMatter }, flat lists { slug, entries, sectionOrder }.
- Edit cards with add_card, remove_card, set_card_note, set_card_printing, set_card_section,
  set_commander, and unset_commander. apply_changes applies an ordered batch of card-level changes
  to one list in a single save (one changelog block). Content hashes for conflict detection are
  handled internally — you never supply them.
- move_cards and remove_cards operate across lists in one atomic batch, addressing each card by
  listType + slug + cardName plus cardId (required to match when the entry carries an &N id —
  load_list shows it) and copyIndex for deck copies.
- create_list creates a new, empty list (format applies to decks only).
- Card lookups: search_cards/autocomplete_card find names (autocomplete_card matches every
  whitespace-separated term against the local cache, in any order, so "in tre" finds "In the
  Trenches"); card_printings/card_price detail one card. price_report prices one list (listType +
  slug) or summarizes every list (no arguments) from the local card cache.
- import_deck imports a decklist from a URL or pasted text; import_csv imports CSV text into a new
  or existing list of any type (create/overwrite/append, with a column-mapping spec).
- import_changes applies a change bundle exported from the site editor ("ritual-change-bundle"
  JSON covering one or more lists) to the underlying lists.
- export_cards renders a CSV, JSON, plain-text, or Markdown export of any mix of lists and card
  picks (filterable by name, set, finish, condition; column selection and order for csv/json) and
  returns the content string.
- diff_lists compares two lists by card name (default) or exact printing and reports matched
  identities with per-side quantities plus only-in-A / only-in-B entries.
- deck_sync_status lists the Archidekt-linked decks (with each deck's lastSynced) and the stored
  Archidekt login; sync_decks then pulls or pushes those decks (dryRun previews). Both require a
  login stored by "ritual login archidekt" or the admin site. A deck whose file holds lines the
  parser cannot read fails rather than syncing, since the save would delete them — report.unreadable
  names those lines; only set ignoreUnreadableLines once the user has agreed to lose them.
- rename_list, delete_list (which requires a matching confirmName), rewrite_history, and
  update_config are destructive; use them deliberately.
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
