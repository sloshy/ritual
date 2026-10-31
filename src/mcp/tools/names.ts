/**
 * The tool names the MCP server registers.
 *
 * Shared with the skills guard test, which asserts that every tool-name-shaped
 * token a skill body mentions is one the server actually registers, so a rename
 * updates one place and the guard follows.
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
  'get_diagnostics',
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
