import { type JSX, createSignal, onMount, For, Match, Show, Switch } from 'solid-js'
import type { BuylistStatusResponse } from '../../../buylist'
import type { ApiErrorResponse } from '../../../api/http'
import type { SellRefreshResponse } from '../../api/sell'
import { resetBuylistQuotes } from '../../../list-view/buylist-quotes'
import { formatDateTime, formatNumber } from '../../../ui/format'
import { useT, useTSegments } from '../../../ui/i18n'
import { apiMessage, type ApiActionMessage } from '../../../api/result'
import { readSyncMessage, type SyncMessage } from '../../../sync/message'
import { useApiText } from '../hooks/useApiAction'
import { COMMAND, commandLine } from '../../../util/cli-tokens'

/**
 * The Card Kingdom buylist's explicit refresh control.
 *
 * The buylist is never refreshed by a page load: the feed is a ~70 MB download,
 * and every read path (the sell endpoints, the site's sell mode) is strictly
 * cache-backed. The *first* download is always a deliberate act — this button,
 * `ritual sell --refresh auto`, or the `refresh_buylist` tool — after which the
 * admin server refreshes a day-old copy at its own startup (unless started with
 * `--refresh no-bulk`/`never`), and this button forces one mid-session
 * (`?force=true`, so it downloads even when the copy is still fresh).
 */

/**
 * How the card describes the cached feed: absent, present, or unreadable. An
 * error is held unrendered — the server's English plus its key, or the card's
 * own fallback — so it relabels when the reader switches language.
 */
type FeedState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: ApiActionMessage }
  | { kind: 'present'; status: BuylistStatusResponse }

function formatStamp(epochMs: number): string {
  return formatDateTime(epochMs)
}

export function BuylistRefreshCard(): JSX.Element {
  const t = useT()
  const tSegments = useTSegments()
  const heldText = useApiText()
  const [state, setState] = createSignal<FeedState>({ kind: 'loading' })
  const [refreshing, setRefreshing] = createSignal(false)
  // The outcome line, the failed download a stale feed stands in for, and the
  // feed rows the download skipped — held unrendered like the error above, so
  // each renders in the reader's language at display time.
  const [message, setMessage] = createSignal<ApiActionMessage | null>(null)
  const [staleFallback, setStaleFallback] = createSignal<SyncMessage | null>(null)
  const [skippedRows, setSkippedRows] = createSignal<SyncMessage[]>([])

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
          message: readSyncMessage(data) ?? apiMessage('admin.buylist.statusFailed'),
        })
        return
      }
      setState({ kind: 'present', status: data })
    } catch {
      setState({ kind: 'error', message: apiMessage('admin.buylist.statusFailed') })
    }
  }

  onMount(() => {
    void loadStatus()
  })

  const failure = (): ApiActionMessage | null => {
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
    setStaleFallback(null)
    setSkippedRows([])
    try {
      // `force=true`: this button is an explicit request, so it downloads even
      // when the cached feed is still within its daily freshness window.
      const response = await fetch('/api/sell/refresh?force=true', {
        method: 'POST',
        credentials: 'same-origin',
      })
      const data = (await response.json()) as SellRefreshResponse | ApiErrorResponse
      if (!response.ok || data.success !== true) {
        setMessage(readSyncMessage(data) ?? apiMessage('admin.buylist.refreshFailed'))
        return
      }
      // A new feed is on disk, so every quote the admin's client-side store
      // already resolved is now against the *old* one — and that store marks an
      // answered printing resolved forever, so an editor opened next would keep
      // showing yesterday's offers for anything it had asked about before.
      // Dropping the store is the whole point of a refresh; pages request on
      // mount, so nothing else has to be told.
      //
      // Only on `refreshed: true`. The other two outcomes changed no feed: a
      // still-fresh copy (`refreshed: false`) and a failed download that fell
      // back to the stale cached one (`refreshed: false` + `staleFallback`)
      // both leave the store quoting exactly the feed it already quoted, so
      // clearing it would only buy a pointless round of re-requests.
      if (data.refreshed) resetBuylistQuotes()
      // That fallback answers 200 with `refreshed: false` — reading only
      // `refreshed` would report it as "already fresh". Both fields are read as
      // wire data: a message only when it is one.
      const fallback = readSyncMessage(data.staleFallback)
      setStaleFallback(fallback)
      setSkippedRows((data.skippedRows ?? []).flatMap((row) => readSyncMessage(row) ?? []))
      setMessage(
        fallback !== null
          ? apiMessage('admin.buylist.notUpdated')
          : apiMessage('admin.buylist.updated', { count: data.productCount }),
      )
      await loadStatus()
    } catch {
      setMessage(apiMessage('admin.buylist.refreshFailed'))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section class="cache-card">
      <h2 class="cache-card-title">{t('admin.buylist.title')}</h2>
      {/* The command sits mid-sentence and has to render as code, so the message
          is drawn as segments and only the {command} parameter gets markup —
          which leaves a translator free to move it. */}
      <p class="page-desc">
        <For
          each={tSegments('admin.buylist.desc', {
            command: commandLine(COMMAND.sell),
          })}
        >
          {(segment) => (segment.kind === 'param' ? <code>{segment.value}</code> : segment.value)}
        </For>
      </p>

      {/* One arm per FeedState, so the states stay structurally exclusive. */}
      <Switch>
        <Match when={state().kind === 'missing'}>
          <p class="cache-card-empty">{t('admin.buylist.empty')}</p>
        </Match>
        <Match when={failure()}>
          {(held) => <p class="cache-card-error">{heldText(held())}</p>}
        </Match>
        <Match when={loadedStatus()}>
          {(status) => (
            <dl class="cache-card-facts">
              <dt>{t('admin.buylist.downloadedLabel')}</dt>
              <dd>
                {formatStamp(status().feedRetrievedAt)}
                <Show when={status().stale}>
                  <span class="cache-card-stale"> {t('admin.buylist.stale')}</span>
                </Show>
              </dd>
              <dt>{t('admin.buylist.stampLabel')}</dt>
              <dd>{status().feedCreatedAt || '—'}</dd>
              <dt>{t('admin.buylist.productsLabel')}</dt>
              <dd>{formatNumber(status().productCount)}</dd>
            </dl>
          )}
        </Match>
      </Switch>

      <Show when={message()}>{(held) => <p class="cache-card-status">{heldText(held())}</p>}</Show>
      <Show when={staleFallback()}>
        {(held) => (
          <ul class="cache-card-warnings">
            <li>{heldText(held())}</li>
          </ul>
        )}
      </Show>
      <Show when={skippedRows().length > 0}>
        <p class="cache-card-skipped-label">{t('admin.buylist.skippedRowsLabel')}</p>
        <ul class="cache-card-warnings cache-card-skipped">
          <For each={skippedRows()}>{(row) => <li>{heldText(row)}</li>}</For>
        </ul>
      </Show>

      <button
        class="btn btn-secondary"
        onClick={() => void handleRefresh()}
        disabled={refreshing() || state().kind === 'loading'}
      >
        {refreshing() ? t('admin.buylist.downloading') : t('admin.buylist.refresh')}
      </button>
    </section>
  )
}
