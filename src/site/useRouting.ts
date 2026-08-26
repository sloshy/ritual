import { createSignal, onMount, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { ListType } from '../list/list-type'
import type { CombinedListRef } from './combined-list'
import { parseCombinedQuery } from './combined-list'

export type Route =
  | { page: 'index'; tab?: 'decks' | 'collections' | 'wanted' }
  | { page: 'deck'; slug: string; primerOpen?: boolean; sectionId?: string }
  | { page: 'collection'; slug: string }
  | { page: 'wanted'; slug: string }
  | { page: 'combined'; all: boolean; allType?: ListType; refs: CombinedListRef[] }
  | { page: 'trade' }
  | { page: 'find' }
  | { page: 'search-results' }

export type UseRoutingResult = {
  route: Accessor<Route>
  visible: Accessor<boolean>
  navigate: (newRoute: Route) => void
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const qIdx = raw.indexOf('?')
  const hash = qIdx < 0 ? raw : raw.slice(0, qIdx)
  const query = qIdx < 0 ? '' : raw.slice(qIdx + 1)
  if (hash === 'combined') {
    const { all, allType, refs } = parseCombinedQuery(query)
    return { page: 'combined', all, allType, refs }
  }
  if (hash.startsWith('deck/')) {
    const rest = hash.slice('deck/'.length)
    const parts = rest.split('/')
    const slug = parts[0]
    if (slug) {
      const primerOpen = parts[1] === 'primer'
      const sectionId = primerOpen ? parts[2] || undefined : undefined
      return { page: 'deck', slug, primerOpen, sectionId }
    }
  }
  if (hash.startsWith('collection/')) {
    const slug = hash.slice('collection/'.length)
    if (slug) return { page: 'collection', slug }
  }
  if (hash.startsWith('wanted/')) {
    const slug = hash.slice('wanted/'.length)
    if (slug) return { page: 'wanted', slug }
  }
  if (hash === 'collections') {
    return { page: 'index', tab: 'collections' }
  }
  if (hash === 'wanted') {
    return { page: 'index', tab: 'wanted' }
  }
  if (hash === 'trade') {
    return { page: 'trade' }
  }
  if (hash === 'find') {
    return { page: 'find' }
  }
  if (hash === 'search-results') {
    return { page: 'search-results' }
  }
  return { page: 'index', tab: 'decks' }
}

/**
 * Which *view* a route names, ignoring in-view state (a deck's open primer, a
 * scrolled-to section) and the hash query entirely.
 *
 * Two things need this. The fade transition is between views, so re-parsing the
 * same view — which every toolbar control does, since filters, the price source
 * and the currency all mirror themselves into the hash query — must not fade
 * the page out and scroll it back to the top. And the app's "close the dialogs"
 * effect is about leaving a view, not about the query changing underneath one:
 * without this, picking a price store inside the card modal wrote the hash,
 * which closed the modal the picker was rendered in.
 */
export function routeIdentity(route: Route): string {
  switch (route.page) {
    case 'deck':
    case 'collection':
    case 'wanted':
      return `${route.page}/${route.slug}`
    case 'combined':
      return `combined/${route.all ? `all:${route.allType ?? ''}` : ''}/${route.refs
        .map((ref) => `${ref.type}:${ref.slug}`)
        .join(',')}`
    case 'index':
      return `index/${route.tab ?? ''}`
    // Listed rather than defaulted: a route added to the union must decide what
    // identifies it, instead of silently collapsing onto its page name.
    case 'trade':
    case 'find':
    case 'search-results':
      return route.page
  }
}

export function useRouting(): UseRoutingResult {
  const [route, setRoute] = createSignal<Route>(parseHash())
  let transitioning = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const [visible, setVisible] = createSignal(true)

  const navigate = (newRoute: Route): void => {
    if (transitioning) return
    // Skip the fade transition for navigation within one view (a deck's primer
    // opening, a section jump, any toolbar control mirroring itself into the
    // hash query) so the page doesn't flash on every TOC click.
    const cur = route()
    if (routeIdentity(cur) === routeIdentity(newRoute)) {
      setRoute(newRoute)
      return
    }
    transitioning = true
    setVisible(false)

    timer = setTimeout(() => {
      setRoute(newRoute)
      window.scrollTo(0, 0)
      setVisible(true)
      transitioning = false
    }, 200)
  }

  const hashHandler = () => navigate(parseHash())

  onMount(() => {
    window.addEventListener('hashchange', hashHandler)
  })

  onCleanup(() => {
    window.removeEventListener('hashchange', hashHandler)
    if (timer !== null) clearTimeout(timer)
  })

  return { route, visible, navigate }
}
