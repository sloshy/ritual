/** Which primary nav destination the current route lights up. */
export type NavActiveState = {
  decks: boolean
  collections: boolean
  wanted: boolean
  all: boolean
  trade: boolean
  find: boolean
}

export type NavDestination = {
  key: keyof NavActiveState
  label: string
  href: string
  /** Tab-bar glyph. Plain Unicode (not emoji) so it renders on any platform font. */
  icon: string
}

/**
 * The primary nav destinations, shared by the desktop header links and the
 * mobile bottom tab bar so the two can never drift apart. "All" (the combined
 * view) is not listed here: its href is computed (`combinedAllHref()`), the tab
 * bar intentionally omits it (five tabs is the practical limit for thumb-sized
 * targets, and it stays reachable through the index pages' "View all" links),
 * so the header renders it separately.
 */
export const NAV_DESTINATIONS: NavDestination[] = [
  { key: 'decks', label: 'Decks', href: '#/', icon: '▦' },
  { key: 'collections', label: 'Collections', href: '#/collections', icon: '▤' },
  { key: 'wanted', label: 'Wanted', href: '#/wanted', icon: '★' },
  { key: 'trade', label: 'Trade', href: '#/trade', icon: '⇄' },
  { key: 'find', label: 'Find', href: '#/find', icon: '⌕' },
]
