import { type JSX, createSignal, onMount, For, Match, Show, Switch } from 'solid-js'
import type { BuylistStatusResponse } from '../../../buylist'
import type { ApiErrorResponse } from '../../api/save-helpers'
import type { SellRefreshResponse } from '../../api/sell'

/**
 * The Card Kingdom buylist's explicit refresh control.
 *
 * The buylist is never refreshed automatically by a page load: the feed is a
 * ~70 MB download, and every read path (the sell endpoints, the site's sell
 * mode) is strictly cache-backed. Downloading it is this button, `ritual sell
 * --refresh auto`, or the `refresh_buylist` tool — always a deliberate act.
 */

/** How the card describes the cached feed: absent, present, or unreadable. */
type FeedState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'present'; status: BuylistStatusResponse }

function formatStamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString()
}

export function BuylistRefreshCard(): JSX.Element {
  const [state, setState] = createSignal<FeedState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = createSignal(false)
  const [message, setMessage] = createSignal<string | null>(null)
  const [warnings, setWarnings] = createSignal<string[]>([])

  const loadStatus = async (): Promise<void> => {
    try {
      const response = await fetch('/api/buylist/status', { credentials: 'same-origin' })
      if (response.status === 503) {
        // Normal on a fresh workspace — nothing has been downloaded yet, which
        // is an empty state offering the button, not an error.
        setState({ kind: 'missing' })
        return
      }
      const data = (await response.json()) as BuylistStatusResponse | ApiErrorResponse
      if (!response.ok || data.success !== true) {
        // `apiError` words every refusal in `message`; surfacing our own string
        // instead would swallow the server's remedy text.
        setState({
          kind: 'error',
          message: data.success === false ? data.message : 'Failed to read the buylist status',
        })
        return
      }
      setState({ kind: 'present', status: data })
    } catch {
      setState({ kind: 'error', message: 'Failed to read the buylist status' })
    }
  }

  onMount(() => {
    void loadStatus()
  })

  const failureMessage = (): string | null => {
    const current = state()
    return current.kind === 'error' ? current.message : null
  }
  const loadedStatus = (): BuylistStatusResponse | null => {
    const current = state()
    return current.kind === 'present' ? current.status : null
  }

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    setMessage(null)
    setWarnings([])
    try {
      // `force=true`: this button is an explicit request, so it downloads even
      // when the cached feed is still within its daily freshness window.
      const response = await fetch('/api/sell/refresh?force=true', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await response.json()) as SellRefreshResponse | ApiErrorResponse
      if (!response.ok || data.success !== true) {
        setMessage(data.success === false ? data.message : 'Failed to refresh the buylist')
        return
      }
      // A failed download that fell back to the stale cached feed answers 200
      // with `refreshed: false` and a warning — reading only `refreshed` would
      // report that as "already fresh".
      setWarnings(data.warnings)
      setMessage(
        data.warnings.length > 0
          ? 'The buylist was not updated.'
          : `Buylist updated — ${data.productCount.toLocaleString()} products.`,
      )
      await loadStatus()
    } catch {
      setMessage('Failed to refresh the buylist')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section class="cache-card">
      <h2 class="cache-card-title">Card Kingdom buylist</h2>
      <p class="page-desc">
        Card Kingdom’s pricelist feed (~70 MB), used by <code>ritual sell</code> and the public
        site’s sell mode. It is only ever downloaded when you ask for it here.
      </p>

      {/* One arm per FeedState, so the states stay structurally exclusive. */}
      <Switch>
        <Match when={state().kind === 'missing'}>
          <p class="cache-card-empty">
            No buylist has been downloaded yet. Refresh to fetch it for the first time.
          </p>
        </Match>
        <Match when={failureMessage()}>{(text) => <p class="cache-card-error">{text()}</p>}</Match>
        <Match when={loadedStatus()}>
          {(status) => (
            <dl class="cache-card-facts">
              <dt>Downloaded</dt>
              <dd>
                {formatStamp(status().feedRetrievedAt)}
                <Show when={status().stale}>
                  <span class="cache-card-stale"> (stale)</span>
                </Show>
              </dd>
              <dt>Card Kingdom stamp</dt>
              <dd>{status().feedCreatedAt || '—'}</dd>
              <dt>Products</dt>
              <dd>{status().productCount.toLocaleString()}</dd>
            </dl>
          )}
        </Match>
      </Switch>

      <Show when={message()}>{(text) => <p class="cache-card-status">{text()}</p>}</Show>
      <Show when={warnings().length > 0}>
        <ul class="cache-card-warnings">
          <For each={warnings()}>{(warning) => <li>{warning}</li>}</For>
        </ul>
      </Show>

      <button
        class="btn btn-secondary"
        onClick={() => void handleRefresh()}
        disabled={refreshing() || state().kind === 'loading'}
      >
        {refreshing() ? 'Downloading…' : 'Refresh buylist'}
      </button>
    </section>
  )
}
