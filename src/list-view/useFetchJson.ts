import { createSignal, createEffect, createMemo, onCleanup } from 'solid-js'
import type { Accessor } from 'solid-js'
import { reportDataFetchError } from './api-base'
import { isAbortError } from '../util/errors'
import { t } from '../i18n/t'
import { fetchJson } from './fetch-json'

export type UseFetchJsonResult<T> = {
  data: Accessor<T | null>
  loading: Accessor<boolean>
  /**
   * Whether the last load failed. A flag, not text: the page words the failure
   * itself, at render time, so the message follows a language switch.
   */
  failed: Accessor<boolean>
}

/** Fetches JSON from a URL with automatic AbortController cleanup. Pass null to skip fetching. */
export function useFetchJson<T>(url: Accessor<string | null>): UseFetchJsonResult<T> {
  const [data, setData] = createSignal<T | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  // Memoized by value: a dependency of the accessor may change without changing
  // the resulting URL (e.g. the API base resolving from null to '' keeps the
  // same relative path) — that must not abort and refetch an in-flight load.
  const resolvedUrl = createMemo(url)

  createEffect(() => {
    const currentUrl = resolvedUrl()
    if (!currentUrl) {
      setData(null)
      setFailed(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setFailed(false)

    void (async () => {
      try {
        const json = await fetchJson<T>(currentUrl, controller.signal)
        setData(() => json)
        setLoading(false)
      } catch (e) {
        if (isAbortError(e)) return
        console.error(t('site.app.loadFailedLog', { url: currentUrl }), e)
        // A dead remote backend flips the app back to the baked data; the URL
        // accessor re-runs this effect against the static copy, clearing the
        // transient failure.
        reportDataFetchError(e)
        setFailed(true)
        setLoading(false)
      }
    })()

    onCleanup(() => controller.abort())
  })

  return { data, loading, failed }
}
