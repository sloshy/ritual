import { useState, useEffect } from 'preact/hooks'

export type UseFetchJsonResult<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

/** Fetches JSON from a URL with automatic AbortController cleanup. Pass null to skip fetching. */
export function useFetchJson<T>(url: string | null): UseFetchJsonResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setData(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        const json = (await response.json()) as T
        setData(json)
        setLoading(false)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.error(`Failed to load ${url}:`, e)
        setError('Failed to load data.')
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [url])

  return { data, loading, error }
}
