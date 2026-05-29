import type { ListType } from '../../list-type'

export type Page =
  | 'dashboard'
  | 'import-deck'
  | 'list-editor'
  | 'list-manager'
  | 'move-cards'
  | 'history'
  | 'build-site'
  | 'cache-refresh'
  | 'archidekt-login'
  | 'settings'
  | 'audit-log'

/** Options for deep-linking into a page. */
export type NavigateOptions = {
  /**
   * Pre-select a list when targeting the editor page, so callers (e.g. Manage
   * Lists) can deep-link straight into editing a specific list.
   */
  slug?: string
  /** Which editor tab to open on the consolidated Edit Lists page. */
  listType?: ListType
}

/** Navigate to a page, optionally deep-linking to a specific list/editor tab. */
export type NavigateFn = (page: Page, options?: NavigateOptions) => void
