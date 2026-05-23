export type Page =
  | 'dashboard'
  | 'import-deck'
  | 'deck-editor'
  | 'list-manager'
  | 'collection-editor'
  | 'wanted-list-editor'
  | 'build-site'
  | 'cache-refresh'
  | 'archidekt-login'
  | 'settings'
  | 'audit-log'

/**
 * Navigate to a page. When targeting an editor page, an optional `slug`
 * pre-selects that list so callers (e.g. Manage Lists) can deep-link straight
 * into editing a specific deck/collection/wanted list.
 */
export type NavigateFn = (page: Page, slug?: string) => void
