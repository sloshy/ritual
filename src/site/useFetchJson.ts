import { createSignal, createEffect, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'

export type UseFetchJsonResult<T> = {
  data: Accessor<T | null>
  loading: Accessor<boolean>
  error: Accessor<string | null>
}

/** Fetches JSON from a URL with automatic AbortController cleanup. Pass null to skip fetching. */
export function useFetchJson<T>(url: Accessor<string | null>): UseFetchJsonResult<T> {
  const [data, setData] = createSignal<T | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const currentUrl = url()
    if (!currentUrl) {
      setData(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const response = await fetch(currentUrl, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const json = (await response.json()) as T
        setData(() => json)
        setLoading(false)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.error(`Failed to load ${currentUrl}:`, e)
        setError('Failed to load data.')
        setLoading(false)
      }
    })()

    onCleanup(() => controller.abort())
  })

  return { data, loading, error }
}
