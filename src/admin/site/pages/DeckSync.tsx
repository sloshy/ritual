import {
  type JSX,
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import type { ArchidektLoginStatus } from '../../../auth/interfaces'
import type {
  DeckSyncDoneEvent,
  DeckSyncErrorEvent,
  DeckSyncRunResponse,
  DeckSyncStatusResponse,
} from '../../api/deck-sync'
import type {
  DeckSyncEvent,
  DeckSyncLogLevel,
  DeckSyncStatus,
  SyncableDeck,
  SyncDirection,
  UnreadableDeck,
} from '../../../deck-sync/engine'
import { ArchidektLoginForm, ArchidektSessionAlert } from '../components/ArchidektSession'
import { StatusAlerts } from '../components/StatusAlerts'
import { formatDuration } from '../../../utils'
import { PageHeading } from '../components/PageHeading'

/** How far a run has progressed; drives the button state and result panel. */
type RunPhase = 'idle' | 'running' | 'done' | 'error'

/** A deck's live state during a run: `running` until its result event arrives. */
type DeckRunStatus = DeckSyncStatus | 'running'

type DeckRunMessage = { level: DeckSyncLogLevel; text: string }

type DeckRunState = {
  deck: string
  status: DeckRunStatus
  messages: DeckRunMessage[]
}

type DirectionOption = {
  id: SyncDirection
  label: string
  description: string
}

const DIRECTIONS: DirectionOption[] = [
  {
    id: 'pull',
    label: 'Pull',
    description:
      'Archidekt → local. Applies remote card and format changes to your deck files and records them in each deck’s changelog.',
  },
  {
    id: 'push',
    label: 'Push',
    description:
      'Local → Archidekt. Sends your card additions, removals, and quantity changes to decks you own on Archidekt.',
  },
]

const RUN_ICONS: Record<DeckRunStatus, string> = {
  running: '⏳',
  synced: '✓',
  skipped: '⏭',
  failed: '✗',
}

/** "2 hours ago", or null when the deck has never synced. */
function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  const elapsed = Date.now() - time
  // A clock skew (or a just-written timestamp) must not read as "in the future".
  return `${formatDuration(Math.max(elapsed, 0))} ago`
}

function lastSyncedLabel(iso: string | null): string {
  return relativeTime(iso) ?? 'never synced'
}

export function DeckSync(): JSX.Element {
  const [decks, setDecks] = createSignal<SyncableDeck[]>([])
  const [archidekt, setArchidekt] = createSignal<ArchidektLoginStatus | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)

  const [direction, setDirection] = createSignal<SyncDirection>('pull')
  const [dryRun, setDryRun] = createSignal(false)
  const [selected, setSelected] = createSignal<string[]>([])

  const [phase, setPhase] = createSignal<RunPhase>('idle')
  const [runDecks, setRunDecks] = createSignal<DeckRunState[]>([])
  const [runLog, setRunLog] = createSignal<DeckRunMessage[]>([])
  const [summary, setSummary] = createSignal<string | null>(null)
  const [runError, setRunError] = createSignal<string | null>(null)
  // Decks the last run refused to touch because their files hold lines the
  // parser cannot read; cleared when the user accepts the loss and re-runs.
  const [unreadable, setUnreadable] = createSignal<UnreadableDeck[]>([])

  let eventSource: EventSource | null = null
  onCleanup(() => eventSource?.close())

  // Only the first load seeds the selection with every deck; later reloads (after
  // a run, or after signing in) preserve whatever the user has chosen — including
  // an empty selection.
  let selectionSeeded = false

  const loadStatus = async (): Promise<void> => {
    try {
      const resp = await fetch('/api/deck-sync', { credentials: 'same-origin' })
      if (!resp.ok) {
        setLoadError('Could not load Archidekt decks.')
        return
      }
      const data = (await resp.json()) as DeckSyncStatusResponse
      const slugs = data.decks.map((deck) => deck.slug)
      // One logical update, so the list and its selection never render mismatched.
      batch(() => {
        setDecks(data.decks)
        setArchidekt(data.archidekt)
        setLoadError(null)
        setSelected((current) =>
          selectionSeeded ? current.filter((slug) => slugs.includes(slug)) : slugs,
        )
      })
      selectionSeeded = true
    } catch {
      setLoadError('Could not load Archidekt decks.')
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void loadStatus()
  })

  const isSelected = (slug: string): boolean => selected().includes(slug)
  const allSelected = (): boolean => decks().length > 0 && selected().length === decks().length
  const loginRequired = (): boolean => archidekt()?.loginRequired !== false
  const running = (): boolean => phase() === 'running'

  const toggleDeck = (slug: string): void => {
    setSelected((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    )
  }

  const toggleAll = (): void => {
    setSelected(allSelected() ? [] : decks().map((deck) => deck.slug))
  }

  /**
   * `indeterminate` has no JSX attribute form, so the partial-selection state is
   * written to the master checkbox as a DOM property. The effect is created in
   * the `ref` callback so it is bound to the element's own lifetime — created at
   * component scope it would run once before the checkbox exists, read no
   * signals, and never run again.
   */
  const trackIndeterminate = (el: HTMLInputElement): void => {
    createEffect(() => {
      el.indeterminate = selected().length > 0 && !allSelected()
    })
  }

  /** The most recent sync across all decks, for the page-level summary line. */
  const lastSyncedOverall = createMemo(() => {
    const stamps = decks()
      .map((deck) => deck.lastSynced)
      .filter((value): value is string => value !== null)
    if (stamps.length === 0) return null
    return stamps.reduce((latest, value) => (value > latest ? value : latest))
  })

  const actionLabel = createMemo(() => {
    const verb = dryRun() ? 'Preview' : direction() === 'pull' ? 'Pull' : 'Push'
    if (allSelected()) return `${verb} all decks`
    const count = selected().length
    return `${verb} ${count} deck${count === 1 ? '' : 's'}`
  })

  /** Create or update one deck's row, preserving arrival order. */
  const updateDeck = (name: string, apply: (state: DeckRunState) => DeckRunState): void => {
    setRunDecks((current) => {
      const index = current.findIndex((entry) => entry.deck === name)
      if (index === -1) {
        return [...current, apply({ deck: name, status: 'running', messages: [] })]
      }
      const next = [...current]
      next[index] = apply(current[index]!)
      return next
    })
  }

  /**
   * `confirmed` is the current run's answer to the unreadable-lines question.
   * The engine reports those decks on every run, confirmed or not, so a run the
   * user already approved must not re-raise the panel it was launched from.
   */
  const handleSyncEvent = (event: DeckSyncEvent, confirmed: boolean): void => {
    switch (event.kind) {
      case 'deck-start':
        updateDeck(event.deck, (state) => ({ ...state, status: 'running' }))
        return
      case 'log': {
        const message: DeckRunMessage = { level: event.level, text: event.message }
        if (event.deck === null) {
          setRunLog((current) => [...current, message])
          return
        }
        updateDeck(event.deck, (state) => ({ ...state, messages: [...state.messages, message] }))
        return
      }
      case 'deck-result':
        updateDeck(event.result.name, (state) => ({ ...state, status: event.result.status }))
        return
      case 'unreadable-lines':
        // Held for the confirmation panel the run ends on — the browser's
        // equivalent of the CLI's prompt. Already-confirmed runs skip it: those
        // lines are being removed on purpose.
        if (!confirmed) setUnreadable(event.decks)
        return
      default: {
        // Every event kind must be rendered somewhere; a new one is a compile error.
        const unhandled: never = event
        throw new Error(`Unhandled deck-sync event: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  const finishRun = (message: string): void => {
    setPhase('done')
    setSummary(message)
    // Refresh the listing so each deck's "last synced" reflects the run.
    void loadStatus()
  }

  const failRun = (message: string, needsLogin: boolean): void => {
    setPhase('error')
    setRunError(message)
    if (needsLogin) void loadStatus()
  }

  /** Sync without progress streaming, used when `EventSource` cannot connect. */
  const runWithoutStream = async (ignoreUnreadableLines: boolean): Promise<void> => {
    try {
      const resp = await fetch('/api/deck-sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: direction(),
          decks: allSelected() ? [] : selected(),
          dryRun: dryRun(),
          ignoreUnreadableLines,
        }),
      })
      const data = (await resp.json()) as DeckSyncRunResponse
      if (!data.success) {
        failRun(data.message, data.loginRequired)
        return
      }
      // One render for the whole report rather than one per deck.
      batch(() => {
        for (const result of data.report.decks) {
          updateDeck(result.name, (state) => ({
            ...state,
            status: result.status,
            messages: result.reason
              ? [...state.messages, { level: 'info', text: result.reason }]
              : state.messages,
          }))
        }
        // The report carries the unreadable decks too, so this path offers the
        // same confirmation the streamed one does.
        if (!ignoreUnreadableLines) setUnreadable(data.report.unreadable)
      })
      finishRun(data.message)
    } catch {
      failRun('Failed to sync decks.', false)
    }
  }

  const streamUrl = (ignoreUnreadableLines: boolean): string => {
    const params = new URLSearchParams({ direction: direction() })
    // An empty deck list means "every Archidekt-linked deck" server-side, which
    // also covers decks added since this page loaded.
    if (!allSelected()) {
      for (const slug of selected()) params.append('deck', slug)
    }
    if (dryRun()) params.set('dryRun', 'true')
    if (ignoreUnreadableLines) params.set('ignoreUnreadableLines', 'true')
    return `/api/deck-sync/stream?${params.toString()}`
  }

  /**
   * Start a run. `ignoreUnreadableLines` is the user's answer to the confirmation
   * panel — the browser's stand-in for the CLI's prompt — and is false for the
   * first attempt, so a deck whose file has unreadable lines is never rewritten
   * without being shown first.
   */
  const handleSync = (ignoreUnreadableLines = false): void => {
    batch(() => {
      setPhase('running')
      setRunDecks([])
      setRunLog([])
      setSummary(null)
      setRunError(null)
      setUnreadable([])
    })

    let es: EventSource
    try {
      es = new EventSource(streamUrl(ignoreUnreadableLines))
    } catch {
      void runWithoutStream(ignoreUnreadableLines)
      return
    }
    eventSource = es

    const close = (): void => {
      es.close()
      eventSource = null
    }

    // Whether the stream ever delivered anything. A connection error before the
    // first frame means the stream never worked (e.g. a proxy that buffers
    // server-sent events) and the run can safely be retried over plain JSON;
    // one *after* means a run is already underway on the server, and retrying
    // would push a second time.
    let received = false

    es.addEventListener('progress', (e: MessageEvent) => {
      received = true
      try {
        handleSyncEvent(JSON.parse(e.data as string) as DeckSyncEvent, ignoreUnreadableLines)
      } catch {
        // Ignore a malformed frame rather than aborting the run.
      }
    })

    es.addEventListener('done', (e: MessageEvent) => {
      close()
      try {
        finishRun((JSON.parse(e.data as string) as DeckSyncDoneEvent).message)
      } catch {
        finishRun('Sync complete.')
      }
    })

    es.addEventListener('error', (e: Event) => {
      const message = e as MessageEvent
      if (!message.data) {
        close()
        if (received) {
          // The run is already in flight server-side; re-issuing it could push a
          // second time. Report the drop and let the user reload to see where it landed.
          failRun('The connection dropped mid-sync. Reload to see how far the run got.', false)
          return
        }
        // Never connected: retry once over plain JSON so a proxy that buffers
        // server-sent events doesn't make the page unusable.
        void runWithoutStream(ignoreUnreadableLines)
        return
      }
      close()
      try {
        const data = JSON.parse(message.data as string) as DeckSyncErrorEvent
        failRun(data.message, data.loginRequired)
      } catch {
        failRun('Failed to sync decks.', false)
      }
    })
  }

  return (
    <div>
      <PageHeading page="deck-sync" />
      <p class="page-desc">
        Sync decks imported from Archidekt. Decks are matched by card name and quantity; a pull also
        adopts the deck’s Archidekt format.
      </p>

      <Show when={!loading()} fallback={<p class="text-muted">Loading Archidekt decks…</p>}>
        <Show when={archidekt()}>
          {(status) => (
            <div class="archidekt-status">
              <ArchidektSessionAlert status={status()} />
              <Show when={status().loginRequired}>
                <ArchidektLoginForm onLoggedIn={() => void loadStatus()} />
              </Show>
            </div>
          )}
        </Show>

        <Show when={loadError()}>
          <div class="alert alert-error">{loadError()}</div>
        </Show>

        <Show
          when={decks().length > 0}
          fallback={
            <p class="text-muted">
              No Archidekt decks found. Import a deck from an Archidekt URL to sync it.
            </p>
          }
        >
          <p class="sync-last-run">
            Last synced:{' '}
            <span class="sync-last-run-value">
              {relativeTime(lastSyncedOverall()) ?? 'never — no deck has synced yet'}
            </span>
          </p>

          <h3 class="section-subheading">Direction</h3>
          <div class="segmented" role="group" aria-label="Sync direction">
            <For each={DIRECTIONS}>
              {(option) => (
                <button
                  type="button"
                  class="segmented-option"
                  data-active={direction() === option.id ? 'true' : undefined}
                  aria-pressed={direction() === option.id}
                  disabled={running()}
                  onClick={() => setDirection(option.id)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
          <p class="sync-direction-desc">
            {DIRECTIONS.find((option) => option.id === direction())?.description}
          </p>

          <h3 class="section-subheading">Decks</h3>
          <ul class="sync-deck-list">
            <li class="sync-deck sync-deck--all">
              <label class="sync-deck-label">
                <input
                  ref={trackIndeterminate}
                  type="checkbox"
                  checked={allSelected()}
                  disabled={running()}
                  onChange={toggleAll}
                />
                <span class="sync-deck-name">All decks</span>
              </label>
              <span class="sync-deck-meta">
                {selected().length} of {decks().length} selected
              </span>
            </li>
            <For each={decks()}>
              {(deck) => (
                <li class="sync-deck">
                  <label class="sync-deck-label">
                    <input
                      type="checkbox"
                      checked={isSelected(deck.slug)}
                      disabled={running()}
                      onChange={() => toggleDeck(deck.slug)}
                    />
                    <span class="sync-deck-name">{deck.name}</span>
                  </label>
                  <span
                    class="sync-deck-meta"
                    title={deck.lastSynced ? new Date(deck.lastSynced).toLocaleString() : undefined}
                  >
                    {lastSyncedLabel(deck.lastSynced)}
                  </span>
                </li>
              )}
            </For>
          </ul>

          <label class="sync-dry-run">
            <input
              type="checkbox"
              checked={dryRun()}
              disabled={running()}
              onChange={(e) => setDryRun(e.currentTarget.checked)}
            />
            Preview only — report what would change without writing files or pushing
          </label>

          {/* Held apart from the Archidekt session banner above, which is also an alert. */}
          <div class="sync-run-status">
            <StatusAlerts status={summary()} error={runError()} />
          </div>

          <button
            class="btn btn-primary btn-lg sync-run-btn"
            disabled={running() || selected().length === 0 || loginRequired()}
            onClick={() => handleSync()}
          >
            {running() ? 'Syncing…' : actionLabel()}
          </button>
          {/* Only when a login form is actually rendered above — a status that
              failed to load leaves the load error to explain the disabled button. */}
          <Show when={archidekt()?.loginRequired === true}>
            <p class="text-muted">Sign in to Archidekt above to sync.</p>
          </Show>

          {/* The browser's stand-in for the CLI's confirmation prompt: the run
              refused to rewrite these files, and re-running is the explicit yes. */}
          <Show when={unreadable().length > 0}>
            <div class="sync-unreadable">
              <p class="sync-unreadable-lead">
                {unreadable().length} deck{unreadable().length === 1 ? '' : 's'} contain lines
                Ritual cannot read. Syncing rewrites the deck file, so these lines would be removed:
              </p>
              <ul class="sync-unreadable-list">
                <For each={unreadable()}>
                  {(deck) => (
                    <li>
                      <span class="sync-unreadable-file">
                        {deck.file} ({deck.name})
                      </span>
                      <For each={deck.warnings}>
                        {(warning) => <span class="sync-unreadable-line">{warning}</span>}
                      </For>
                    </li>
                  )}
                </For>
              </ul>
              <button
                class="btn btn-secondary sync-unreadable-btn"
                disabled={running()}
                onClick={() => handleSync(true)}
              >
                Sync anyway and remove those lines
              </button>
            </div>
          </Show>

          <Show when={runDecks().length > 0 || runLog().length > 0}>
            <h3 class="section-subheading">Progress</h3>
            <ul class="sync-run">
              <For each={runLog()}>
                {(message) => (
                  <li class="sync-run-note" data-level={message.level}>
                    {message.text}
                  </li>
                )}
              </For>
              <For each={runDecks()}>
                {(deck) => (
                  <li class="sync-run-deck" data-status={deck.status}>
                    <span class="sync-run-icon">{RUN_ICONS[deck.status]}</span>
                    <div class="sync-run-body">
                      <span class="sync-run-name">{deck.deck}</span>
                      <For each={deck.messages}>
                        {(message) => (
                          <span class="sync-run-message" data-level={message.level}>
                            {message.text}
                          </span>
                        )}
                      </For>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </div>
  )
}
