import { createSignal, createEffect, createMemo, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import { reportDataFetchError } from './api-base'
import { isAbortError } from './utils'

export type UseFetchJsonResult<T> = {
  data: Accessor<T | null>
  loading: Accessor<boolean>
  error: Accessor<string | null>
}

/** Fetches JSON and parses it. Throws on non-OK responses or fetch failures (including AbortError). */
export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, signal ? { signal } : undefined)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as T
}

/** Fetches JSON from a URL with automatic AbortController cleanup. Pass null to skip fetching. */
export function useFetchJson<T>(url: Accessor<string | null>): UseFetchJsonResult<T> {
  const [data, setData] = createSignal<T | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Memoized by value: a dependency of the accessor may change without changing
  // the resulting URL (e.g. the API base resolving from null to '' keeps the
  // same relative path) — that must not abort and refetch an in-flight load.
  const resolvedUrl = createMemo(url)

  createEffect(() => {
    const currentUrl = resolvedUrl()
    if (!currentUrl) {
      setData(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const json = await fetchJson<T>(currentUrl, controller.signal)
        setData(() => json)
        setLoading(false)
      } catch (e) {
        if (isAbortError(e)) return
        console.error(`Failed to load ${currentUrl}:`, e)
        // A dead remote backend flips the app back to the baked data; the URL
        // accessor re-runs this effect against the static copy, clearing the
        // transient error.
        reportDataFetchError(e)
        setError('Failed to load data.')
        setLoading(false)
      }
    })()

    onCleanup(() => controller.abort())
  })

  return { data, loading, error }
}
