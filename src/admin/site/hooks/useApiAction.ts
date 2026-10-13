import { type Accessor, createMemo, createSignal } from 'solid-js'
import { apiMessage, type ApiActionMessage } from '../../../api/result'
import { isRecord } from '../../../util/json'
import { useI18n } from '../../../ui/i18n'
import { readSyncMessage, renderSyncMessage, type SyncMessage } from '../../../sync/message'

export type UseApiActionResult = {
  status: Accessor<string | null>
  error: Accessor<string | null>
  loading: Accessor<boolean>
  /**
   * Issue a request and hold whatever it says. `fallbackError` covers the two
   * cases where the server says nothing usable; pass `apiMessage(key)` rather
   * than a rendered string so it too relabels on a locale switch.
   */
  run: (url: string, options?: RequestInit, fallbackError?: ApiActionMessage) => Promise<boolean>
  setStatus: (message: ApiActionMessage | null) => void
  setError: (message: ApiActionMessage | null) => void
}

/**
 * Narrow one action response off the wire.
 *
 * A response is untyped JSON, and a server ahead of (or behind) this bundle may
 * put a `messageKey` (or a nested param's key) the catalog does not have into an
 * alert. `renderSyncMessage` is the gate: a message whose tree names a key this
 * build does not know renders as the English `message` it carries, whole —
 * the fallback the design already relies on for an unconverted handler.
 */
function readApiResponse(raw: unknown): ApiActionParsed {
  const success = isRecord(raw) && raw.success === true
  return { success, carried: readSyncMessage(raw) }
}

/** What {@link readApiResponse} extracts: the verdict and the prose, if any. */
type ApiActionParsed = {
  success: boolean
  carried: SyncMessage | null
}

/**
 * `const text = useApiText()` at the top of a component, then `text(held)` in
 * JSX: a held message rendered in the reader's language, tracking the locale
 * signal so a switch relabels it on screen.
 */
export function useApiText(): (message: ApiActionMessage | null) => string | null {
  const { locale } = useI18n()
  return (message) => {
    if (message === null) return null
    return typeof message === 'string' ? message : renderSyncMessage(message, locale())
  }
}

export function useApiAction(): UseApiActionResult {
  const text = useApiText()
  const [statusMessage, setStatus] = createSignal<ApiActionMessage | null>(null)
  const [errorMessage, setError] = createSignal<ApiActionMessage | null>(null)
  const [loading, setLoading] = createSignal(false)

  /**
   * Render a held message in the active locale. `text` reads the locale signal,
   * so reading these in JSX relabels an alert already on screen when the
   * language changes; the memo only shares one render between readers.
   */
  const rendered = (message: Accessor<ApiActionMessage | null>): Accessor<string | null> =>
    createMemo(() => text(message()))

  const status = rendered(statusMessage)
  const error = rendered(errorMessage)

  async function run(
    url: string,
    options?: RequestInit,
    fallbackError?: ApiActionMessage,
  ): Promise<boolean> {
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const resp = await fetch(url, { credentials: 'same-origin', ...options })
      // The whole triple is kept, not just `message`: rendering is deferred to
      // the accessors above, so the key is what a later locale switch reads.
      const { success, carried } = readApiResponse(await resp.json())
      if (success) {
        if (carried) setStatus(carried)
        return true
      }
      setError(carried ?? fallbackError ?? apiMessage('admin.app.requestFailed'))
      return false
    } catch {
      setError(fallbackError ?? apiMessage('admin.app.requestFailed'))
      return false
    } finally {
      setLoading(false)
    }
  }

  return { status, error, loading, run, setStatus, setError }
}
