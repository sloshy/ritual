import { type HttpClient } from './interfaces'

export function setupGlobalFetch() {
  const originalFetch = global.fetch

  const newFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const options = init || {}

    const headers = new Headers(options.headers)

    // Set User-Agent so that APIs know who's calling them
    // Scryfall especially cares about this
    headers.set('User-Agent', 'Ritual CLI/0.1.0')

    const newOptions = {
      ...options,
      headers,
    }

    return originalFetch(url, newOptions)
  }

  // Copy properties like 'preconnect' from original fetch to new fetch
  Object.assign(newFetch, originalFetch)

  global.fetch = newFetch as typeof global.fetch
}

export const defaultHttpClient: HttpClient = {
  fetch: (url, init) => global.fetch(url, init),
}
