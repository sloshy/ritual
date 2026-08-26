import { combinedAllHref } from '../list-view/combined-list'
import type { MessageKey } from '../i18n/messages/en'

export type NavDestination = {
  /** Identifies the destination; the source of `NavActiveState`'s keys. */
  key: string
  /**
   * The destination's name, as a {@link MessageKey} rather than rendered text.
   * This list is evaluated once at module load, so a string would leave the
   * header links and the mobile tab bar in the boot-time language after a
   * locale switch — resolve it where it is rendered.
   */
  label: MessageKey
  href: string
  /** Tab-bar glyph. Plain Unicode (not emoji) so it renders on any platform font. */
  icon: string
}

/**
 * The primary nav destinations, shared verbatim by the desktop header links and
 * the mobile bottom tab bar — both render this list in full, in this order, so
 * the two can never drift apart. "All" is the combined view of every list: its
 * href comes from `combinedAllHref()` called with no list type, i.e. every list
 * of every type rather than one type's `#/combined?all=deck`.
 */
export const NAV_DESTINATIONS = [
  { key: 'decks', label: 'domain.nav.decks', href: '#/', icon: '▦' },
  { key: 'collections', label: 'domain.nav.collections', href: '#/collections', icon: '▤' },
  { key: 'wanted', label: 'domain.nav.wanted', href: '#/wanted', icon: '★' },
  { key: 'all', label: 'domain.nav.all', href: combinedAllHref(), icon: '▣' },
  { key: 'trade', label: 'domain.nav.trade', href: '#/trade', icon: '⇄' },
  { key: 'find', label: 'domain.nav.find', href: '#/find', icon: '⌕' },
] as const satisfies readonly NavDestination[]

/**
 * Which primary nav destination the current route lights up — one flag per
 * entry above, derived from the list rather than declared alongside it, so a
 * flag can never exist for a destination nothing renders (the drift that once
 * left "All" out of the tab bar). Adding an entry above is a compile error in
 * `navActive` (app.tsx) until it computes that entry's flag.
 */
export type NavActiveState = Record<(typeof NAV_DESTINATIONS)[number]['key'], boolean>
