import { useState, useEffect, useCallback, useRef } from 'preact/hooks'

export type Route =
  | { page: 'index'; tab?: 'decks' | 'collections' | 'wanted' }
  | { page: 'deck'; slug: string; primerOpen?: boolean; sectionId?: string }
  | { page: 'collection'; slug: string }
  | { page: 'wanted'; slug: string }

export type UseRoutingResult = {
  route: Route
  visible: boolean
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
  const [route, setRoute] = useState<Route>(parseHash)
  const routeRef = useRef(route)
  routeRef.current = route

  const transitioningRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [visible, setVisible] = useState(true)

  const navigate = useCallback((newRoute: Route) => {
    if (transitioningRef.current) return
    // Skip the fade transition for within-deck navigation (primer open/close,
    // section jumps) so the page doesn't flash on every TOC click.
    const cur = routeRef.current
    if (cur.page === 'deck' && newRoute.page === 'deck' && cur.slug === newRoute.slug) {
      setRoute(newRoute)
      return
    }
    transitioningRef.current = true
    setVisible(false)

    timerRef.current = setTimeout(() => {
      setRoute(newRoute)
      window.scrollTo(0, 0)
      setVisible(true)
      transitioningRef.current = false
    }, 200)
  }, [])

  // Cancel any in-flight transition timer if the component unmounts.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    const handler = () => navigate(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [navigate])

  return { route, visible, navigate }
}
