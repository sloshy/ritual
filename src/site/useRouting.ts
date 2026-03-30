import { createSignal, onMount, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

export type Route =
  | { page: 'index'; tab?: 'decks' | 'collections' | 'wanted' }
  | { page: 'deck'; slug: string; primerOpen?: boolean; sectionId?: string }
  | { page: 'collection'; slug: string }
  | { page: 'wanted'; slug: string }

export type UseRoutingResult = {
  route: Accessor<Route>
  visible: Accessor<boolean>
  navigate: (newRoute: Route) => void
}

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
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
  return { page: 'index', tab: 'decks' }
}

export function useRouting(): UseRoutingResult {
  const [route, setRoute] = createSignal<Route>(parseHash())
  let transitioning = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const [visible, setVisible] = createSignal(true)

  const navigate = (newRoute: Route): void => {
    if (transitioning) return
    // Skip the fade transition for within-deck navigation (primer open/close,
    // section jumps) so the page doesn't flash on every TOC click.
    const cur = route()
    if (cur.page === 'deck' && newRoute.page === 'deck' && cur.slug === newRoute.slug) {
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
