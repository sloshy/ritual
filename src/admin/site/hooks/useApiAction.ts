import { createSignal } from 'solid-js'

export function useApiAction() {
  const [status, setStatus] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  async function run(url: string, options?: RequestInit, fallbackError?: string): Promise<boolean> {
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const resp = await fetch(url, { credentials: 'same-origin', ...options })
      const data = (await resp.json()) as { success: boolean; message?: string }
      if (data.success) {
        if (data.message) setStatus(data.message)
        return true
      } else {
        setError(data.message ?? fallbackError ?? 'Request failed')
        return false
      }
    } catch {
      setError(fallbackError ?? 'Request failed')
      return false
    } finally {
      setLoading(false)
    }
  }

  return { status, error, loading, run, setStatus, setError }
}
