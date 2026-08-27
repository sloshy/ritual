import { type Accessor, createMemo, createSignal } from 'solid-js'
import {
  apiMessage,
  renderApiMessage,
  type ApiMessage,
  type ApiMessageParams,
} from '../../../api/result'
import { isMessageKey } from '../../../i18n/t'
import { useTDynamic } from '../../../ui/i18n'

/**
 * A status or error line held by {@link useApiAction}: either prose a caller
 * handed in already rendered, or the message triple a response carried.
 *
 * Held **unrendered**. An alert can sit on screen for minutes, so storing the
 * formatted string would freeze it in the language that was active when the
 * request came back — a locale switch would relabel the page around a stale
 * sentence. This is the same reason `useEditorStatus` stores its status as a
 * key (plan §7.4).
 */
export type ApiActionMessage = string | ApiMessage

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
 * A response is untyped JSON, and asserting it into shape would let a server
 * ahead of (or behind) this bundle put a `messageKey` the catalog does not have
 * into an alert — rendering the raw key, or throwing under `RITUAL_I18N_STRICT`.
 * `isMessageKey` is the gate; a key this build does not know is dropped and the
 * English `message` covers the gap, which is the fallback the design already
 * relies on for an unconverted handler (plan §7.7).
 */
function readApiResponse(raw: unknown): ApiActionParsed {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const success = body.success === true
  if (typeof body.message !== 'string') return { success, carried: null }
  const carried: ApiMessage = { message: body.message }
  if (isMessageKey(body.messageKey)) {
    carried.messageKey = body.messageKey
    if (typeof body.messageParams === 'object' && body.messageParams !== null) {
      carried.messageParams = body.messageParams as ApiMessageParams
    }
  }
  return { success, carried }
}

/** What {@link readApiResponse} extracts: the verdict and the prose, if any. */
type ApiActionParsed = {
  success: boolean
  carried: ApiMessage | null
}

export function useApiAction(): UseApiActionResult {
  const t = useTDynamic()
  const [statusMessage, setStatus] = createSignal<ApiActionMessage | null>(null)
  const [errorMessage, setError] = createSignal<ApiActionMessage | null>(null)
  const [loading, setLoading] = createSignal(false)

  /**
   * Render a held message in the active locale. A `createMemo` rather than a
   * plain function so the translator's locale signal is read reactively: that
   * is what relabels an alert already on screen when the language changes.
   */
  const rendered = (message: Accessor<ApiActionMessage | null>): Accessor<string | null> =>
    createMemo(() => {
      const held = message()
      if (held === null) return null
      return typeof held === 'string' ? held : renderApiMessage(t, held)
    })

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
