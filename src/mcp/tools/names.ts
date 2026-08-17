/**
 * The tool names the MCP server registers, and the ones it used to.
 *
 * Shared with the skills guard test, which asserts that no skill body mentions a
 * name that no longer exists and that every tool-name-shaped token it does
 * mention is one the server actually registers. Keeping both lists here means a
 * rename updates one place and the guard follows.
 */

/** Every tool name the server registers, in registration order (read → write → destructive). */
export const MCP_TOOL_NAMES = [
  'list_lists',
  'get_sync_status',
  'get_list',
  'search_scryfall',
  'autocomplete_card',
  'find_cards',
  'get_card_details',
  'get_card_printings',
  'get_card_price',
  'get_price_report',
  'get_sell_report',
  'get_sell_cart',
  'get_buylist_quotes',
  'get_history',
  'get_config',
  'get_cache_status',
  'diff_lists',
  'export_cards',
  'create_list',
  'import_deck',
  'import_csv',
  'import_change_bundle',
  'set_list_metadata',
  'add_card',
  'remove_card',
  'set_card_printing',
  'set_card_art',
  'apply_changes',
  'move_selected_cards',
  'remove_selected_cards',
  'rename_list',
  'delete_list',
  'rewrite_history',
  'update_config',
  'build_site',
  'sync_decks',
  'sync_collection',
  'refresh_cache',
  'refresh_buylist',
] as const

/** Every tool name the server registers, as a type. */
export type McpToolName = (typeof MCP_TOOL_NAMES)[number]

/** Names retired by the Phase 2 rename/merge sweep — never valid again. */
export const RETIRED_MCP_TOOL_NAMES = [
  'load_list',
  'load_history',
  'card_printings',
  'card_price',
  'price_report',
  'import_changes',
  'move_cards',
  'remove_cards',
  'deck_sync_status',
  'collection_sync_status',
  'set_card_note',
  'set_card_section',
  'set_commander',
  'unset_commander',
  'get_audit_log',
  'search_cards',
] as const
