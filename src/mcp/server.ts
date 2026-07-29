import { McpServer } from '@modelcontextprotocol/server'
import { version } from '../version'
import { NEVER_CACHE, STATIC_CATALOG_CACHE } from './cache-hints'
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
  picks (filterable by name, set, finish, condition; column selection and order for csv/json, plus a
  value dialect — ritual or archidekt — and saved/built-in presets: the built-in "archidekt" preset
  writes the CSV Archidekt's collection importer takes, the same file a large sync_collection push
  uploads) and returns the content string.
- diff_lists compares two lists by card name (default) or exact printing and reports matched
  identities with per-side quantities plus only-in-A / only-in-B entries.
- deck_sync_status lists the Archidekt-linked decks (with each deck's lastSynced) and the stored
  Archidekt login; sync_decks then pulls or pushes those decks (dryRun previews; only "additions"
  or "removals" applies just one side of each diff, relative to the sync destination — the local
  files on a pull, Archidekt on a push).
- sync_collection is the collection counterpart: the account has ONE Archidekt collection, so a run
  compares the union of the collection lists in scope (lists, omitted = every collection list)
  against the whole remote collection — naming a subset declares those lists are what it mirrors, so
  pair it with only "additions" when they are not the whole story. into names the list a pull adds
  cards to (default: the collectionSync.pullTarget config key), created if missing; a push ignores
  it. A pull that must take only SOME of a printing's copies when they live in several lists cannot
  know which list lost the card: removalPriority (list names, in priority order) says which lists
  may give copies up, and without it — or when it cannot cover them — the whole run fails and writes
  nothing at all, not even the account's lastSynced. report.ambiguous names every ambiguity the
  planner found whether or not a priority placed them, so report.errors is what says the run failed.
  Taking every copy, or copies held in one list, is never ambiguous. collection_sync_status lists
  what a run can cover, the default pull target, the CSV threshold (csvThreshold), and when the
  account last synced (a run that wrote nothing does not stamp it).
- A push creates each new printing with its own paced search + create, so one adding more than
  csvThreshold (25) of them refuses to run at all unless csv: true sends those additions through
  Archidekt's CSV importer instead — one upload, rows built from the local Scryfall cache, no
  searches. Set csv: true for any large push; report.csv then says what the import did (rows,
  chunks, per-row failures, and the additions whose printing the cache did not hold and which were
  added one at a time). Quantity changes and removals never ride the CSV, and a dry run reports the
  upload it would make without needing the flag.
- report.localIncomplete says a list in scope did not make it into the comparison (bad name,
  unreadable file, or held back for unreadable lines). The local side is then short of cards it
  really holds, so a pull adds nothing and a push removes nothing — fix or accept those lists and
  run again.
- Both sync tools require a login stored by "ritual login archidekt" or the admin site (check
  deck_sync_status / collection_sync_status first), and both refuse a list whose file holds lines
  the parser cannot read,
  since syncing would lose them — report.unreadable names those lines; only set
  ignoreUnreadableLines once the user has agreed to lose them. A run that finishes reports success
  even when individual decks or lists failed; read report.failedCount.
- rename_list, delete_list (which requires a matching confirmName), rewrite_history, and
  update_config are destructive; use them deliberately.
- Lists are also exposed as readable resources at ritual://{type}/{slug}.`

/** Build the Ritual MCP server with all tools and resources registered (transport-agnostic). */
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'ritual', version },
    {
      // The SDK defaults declared capabilities to `listChanged: true`. Ritual
      // never sends list-changed notifications (nor supports subscriptions), so
      // advertising them would be a lie — opt out explicitly.
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
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
  registerReadTools(server)
  registerWriteTools(server)
  registerDestructiveTools(server)
  registerResources(server)
  return server
}
