import { type HttpClient } from './interfaces'
import { version } from './version'

function isMoxfieldApiRequest(url: string | URL | Request): boolean {
  const rawUrl = url instanceof Request ? url.url : String(url)
  try {
    const parsed = new URL(rawUrl)
    return parsed.hostname === 'api2.moxfield.com'
  } catch {
    return false
  }
}

export function setupGlobalFetch() {
  const originalFetch = global.fetch

  const newFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const options = init || {}

    const headers = new Headers(options.headers)
    const moxfieldUserAgent = process.env.MOXFIELD_USER_AGENT?.trim()

    // Set User-Agent so that APIs know who's calling them
    // For Moxfield, use a per-user configured user agent when provided.
    if (isMoxfieldApiRequest(url) && moxfieldUserAgent) {
      headers.set('User-Agent', moxfieldUserAgent)
    } else {
      // Scryfall especially cares about this
      headers.set('User-Agent', `Ritual CLI/${version}`)
    }

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
