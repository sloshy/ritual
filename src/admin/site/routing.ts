/**
 * Hash-based routing for the admin site, using the same `#/…` scheme as the
 * public site so both apps address their pages the same way. Every page has its
 * own URL, so reloads, bookmarks, copied links, and the browser's back/forward
 * buttons all land where they should.
 *
 * The URL changes two ways:
 *
 * - {@link RoutingController.navigate} — an explicit move to another page (a
 *   sidebar item, a dashboard card, "Edit" in Manage Lists). Adds a history
 *   entry and remounts the page.
 * - {@link RoutingController.replace} — in-page state the URL should track (the
 *   editor's open tab and selected list). Rewrites the current entry, so Back
 *   returns to the page you arrived from instead of stepping backwards through
 *   list selections, and the mounted page keeps its state.
 */
import { batch, createContext, createSignal, onCleanup, useContext } from 'solid-js'
import type { Accessor } from 'solid-js'
import { isListType, type ListType } from '../../list-type'
import type { NavigationAttempt } from '../../editor/navigation-guard'

export type Page =
  | 'dashboard'
  | 'import-deck'
  | 'import-csv'
  | 'import-changes'
  | 'list-editor'
  | 'list-manager'
  | 'move-cards'
  | 'history'
  | 'build-site'
  | 'cache-refresh'
  | 'deck-sync'
  | 'archidekt-login'
  | 'settings'
  | 'audit-log'

/**
 * What the Edit Lists page has open: a type tab, and optionally the list being
 * edited in it. A list without a tab has nowhere to be shown, which is why the
 * two are one value rather than two independent fields.
 */
export type EditorTarget = {
  /** Which editor tab is open. */
  listType: ListType
  /**
   * Which list that tab is editing. Absent leaves the editor on its empty
   * selector, as a bare `#/edit/deck` does.
   */
  slug?: string
}

/** Where in the admin site the URL points: a page, plus the editor's place within it. */
export type Route =
  | { page: Exclude<Page, 'list-editor'> }
  | { page: 'list-editor'; editing?: EditorTarget }

/**
 * Deep-link details for a navigation — currently only the editor's tab and list,
 * so callers (e.g. Manage Lists) can link straight into editing a specific list.
 * Ignored for pages that have nowhere to put them.
 */
export type NavigateOptions = EditorTarget

/** Navigate to a page, optionally deep-linking to a specific editor tab/list. */
export type NavigateFn = (page: Page, options?: NavigateOptions) => void

/** The route a page plus deep-link options addresses. */
export function toRoute(page: Page, options?: NavigateOptions): Route {
  if (page === 'list-editor') return options === undefined ? { page } : { page, editing: options }
  return { page }
}

/** The hash path each page owns, without the leading `#/`. */
const PAGE_PATHS: Record<Page, string> = {
  dashboard: '',
  'list-editor': 'edit',
  'move-cards': 'move',
  'list-manager': 'lists',
  history: 'history',
  'import-deck': 'import/deck',
  'import-csv': 'import/csv',
  'import-changes': 'import/changes',
  'build-site': 'build',
  'cache-refresh': 'cache',
  'deck-sync': 'sync',
  'archidekt-login': 'archidekt',
  settings: 'settings',
  'audit-log': 'audit',
}

/** Reverse of {@link PAGE_PATHS}, built once. */
const PATH_PAGES = new Map<string, Page>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as Page]),
)

/** The canonical hash for a route, e.g. `#/edit/deck/My%20Deck`. */
export function routeToHash(route: Route): string {
  const path = PAGE_PATHS[route.page]
  if (route.page !== 'list-editor' || route.editing === undefined) return `#/${path}`
  const { listType, slug } = route.editing
  // Slugs are list file names, so they carry spaces, `&`, and `#` — all of which
  // would otherwise truncate the hash or split into another segment.
  return `#/${path}/${listType}${slug === undefined ? '' : `/${encodeURIComponent(slug)}`}`
}

/** Percent-decode a slug segment, keeping it as typed when the escapes are malformed. */
function decodeSlug(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Read a route out of a location hash.
 *
 * Parsing is deliberately lenient rather than error-reporting: the hash is
 * user-editable, and the only sensible response to something unrecognized is
 * the dashboard — the same fallback the public site's router uses. Unknown
 * pages, a stray trailing slash, and an editor tab that is not a list type all
 * resolve to the nearest valid route.
 */
export function parseHash(hash: string): Route {
  // A query string belongs to the page, not the route — the public site's router
  // splits it off the same way before matching.
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? ''
  const segments = path.split('/').filter((segment) => segment.length > 0)

  // Two-segment paths (`import/deck`) are matched first so their first segment
  // is never mistaken for a page of its own.
  const [first = '', second, third] = segments
  const nested = second === undefined ? undefined : PATH_PAGES.get(`${first}/${second}`)
  if (nested) return { page: nested }

  const page = PATH_PAGES.get(first)
  if (page === undefined) return { page: 'dashboard' }
  if (page !== 'list-editor') return { page }
  if (second === undefined || !isListType(second)) return { page }

  return third === undefined
    ? { page, editing: { listType: second } }
    : { page, editing: { listType: second, slug: decodeSlug(third) } }
}

export type RoutingController = {
  route: Accessor<Route>
  /**
   * Identifies the current navigation. It changes only when the page should
   * start fresh — a link, or the browser's history — and never when the mounted
   * page reports its own state through {@link RoutingController.replace}, so an
   * editor is not torn down while it is being used.
   */
  navKey: Accessor<object>
  navigate: NavigateFn
  /** Point the URL at in-page state without adding a history entry. */
  replace: (route: Route) => void
}

/**
 * Create the router. `attempt` routes every navigation through the unsaved-
 * changes guard: history navigation (Back/Forward) has already changed the URL
 * by the time we see it, so a declined navigation puts the previous URL back.
 */
export function createRouting(attempt: NavigationAttempt): RoutingController {
  const [route, setRoute] = createSignal<Route>(parseHash(window.location.hash))
  // An identity, not a count: the page is keyed on it, so it must never take a
  // falsy value (which would render nothing at all).
  const [navKey, setNavKey] = createSignal<object>({})

  // Give the address bar the canonical URL of whatever was asked for — a bare
  // `/`, a trailing slash, or an unknown page all arrive with the hash saying
  // something other than the page actually shown.
  const canonical = routeToHash(route())
  if (window.location.hash !== canonical) window.history.replaceState(null, '', canonical)

  const go = (next: Route): void => {
    // One logical navigation: batched so the page mounts once. Written
    // separately, the route write would mount the destination page and the key
    // write would immediately dispose and rebuild it, running every mount-time
    // fetch twice.
    batch(() => {
      setRoute(next)
      setNavKey({})
    })
  }

  const navigate: NavigateFn = (page, options) => {
    // Clicking the page already open does nothing, so an editor mid-edit is not
    // reset by its own sidebar item. A deep link (Manage Lists' "Edit") asks for
    // a specific list, so it navigates even from the editor.
    if (page === route().page && options === undefined) return
    const next = toRoute(page, options)
    const hash = routeToHash(next)
    attempt(() => {
      go(next)
      // Assigning the hash is what pushes the history entry; the `hashchange` it
      // fires is a no-op because `route` already holds the destination.
      window.location.hash = hash
    })
  }

  const replace = (next: Route): void => {
    const hash = routeToHash(next)
    if (hash === routeToHash(route())) return
    setRoute(next)
    window.history.replaceState(null, '', hash)
  }

  const onHashChange = (): void => {
    const current = routeToHash(route())
    const next = parseHash(window.location.hash)
    if (routeToHash(next) === current) return
    attempt(
      () => go(next),
      // Declined: restore the URL of the page still on screen. Replacing (rather
      // than pushing) overwrites the entry the browser just moved to, so the
      // refused page does not linger in the history stack.
      () => window.history.replaceState(null, '', current),
    )
  }

  // Registered immediately rather than on mount, matching the canonicalization
  // above: the router is live from the moment it is created.
  window.addEventListener('hashchange', onHashChange)
  onCleanup(() => window.removeEventListener('hashchange', onHashChange))

  return { route, navKey, navigate, replace }
}

const RoutingContext = createContext<RoutingController>()

export const RoutingProvider = RoutingContext.Provider

/** The router, from any component mounted under the app's {@link RoutingProvider}. */
export function useRouting(): RoutingController {
  const routing = useContext(RoutingContext)
  if (!routing) throw new Error('useRouting called outside of a RoutingProvider')
  return routing
}
