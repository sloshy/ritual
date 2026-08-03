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
  DeckSyncRequest,
  DeckSyncRunResponse,
  DeckSyncStatusResponse,
} from '../../api/deck-sync'
import type { DeckSyncEvent, SyncableDeck, UnreadableDeck } from '../../../deck-sync/engine'
import { unreadableConsequence, type SyncDirection } from '../../../sync-common'
import { ArchidektLoginForm, ArchidektSessionAlert } from '../components/ArchidektSession'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  ChangeFilterPicker,
  ChoicePicker,
  changeFilterParam,
  type ChangeFilterChoice,
  type SyncChoice,
} from '../components/SyncControls'
import { SyncRunLog } from '../components/SyncRunLog'
import { UnreadableLinesPanel } from '../components/UnreadableLinesPanel'
import {
  lastSyncedLabel,
  relativeTime,
  upsertRunItem,
  withMessage,
  type SyncRunItem,
  type SyncRunMessage,
  type SyncRunPhase,
} from '../sync-run'
import { openSyncStream, type SyncStream } from '../sync-stream'
import { PageHeading } from '../components/PageHeading'

const DIRECTIONS: SyncChoice<SyncDirection>[] = [
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

export function DeckSync(): JSX.Element {
  const [decks, setDecks] = createSignal<SyncableDeck[]>([])
  const [archidekt, setArchidekt] = createSignal<ArchidektLoginStatus | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)

  const [direction, setDirection] = createSignal<SyncDirection>('pull')
  const [changeFilter, setChangeFilter] = createSignal<ChangeFilterChoice>('all')
  const [dryRun, setDryRun] = createSignal(false)
  const [selected, setSelected] = createSignal<string[]>([])

  const [phase, setPhase] = createSignal<SyncRunPhase>('idle')
  const [runDecks, setRunDecks] = createSignal<SyncRunItem[]>([])
  const [runLog, setRunLog] = createSignal<SyncRunMessage[]>([])
  const [summary, setSummary] = createSignal<string | null>(null)
  const [runError, setRunError] = createSignal<string | null>(null)
  // Decks the last run refused to touch because their files hold lines the
  // parser cannot read; cleared when the user accepts the loss and re-runs.
  const [unreadable, setUnreadable] = createSignal<UnreadableDeck[]>([])

  let stream: SyncStream | null = null
  onCleanup(() => stream?.close())

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
  const updateDeck = (name: string, apply: (item: SyncRunItem) => SyncRunItem): void => {
    setRunDecks((current) => upsertRunItem(current, name, apply))
  }

  /**
   * `confirmed` is the current run's answer to the unreadable-lines question.
   * The engine reports those decks on every run, confirmed or not, so a run the
   * user already approved must not re-raise the panel it was launched from.
   */
  const handleSyncEvent = (event: DeckSyncEvent, confirmed: boolean): void => {
    switch (event.kind) {
      case 'deck-start':
        updateDeck(event.deck, (item) => ({ ...item, status: 'running' }))
        return
      case 'log': {
        const message: SyncRunMessage = { level: event.level, text: event.message }
        if (event.deck === null) {
          setRunLog((current) => [...current, message])
          return
        }
        updateDeck(event.deck, withMessage(message))
        return
      }
      case 'deck-result':
        updateDeck(event.result.name, (item) => ({ ...item, status: event.result.status }))
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
      // Typed against the endpoint's own contract, so a renamed field is a
      // compile error here rather than a 400 at runtime.
      const body: DeckSyncRequest = {
        direction: direction(),
        decks: allSelected() ? [] : selected(),
        dryRun: dryRun(),
        ignoreUnreadableLines,
        only: changeFilterParam(changeFilter()),
        // No override here yet: a push whose remote deck changed since the last
        // sync fails with that reason, and pulling first is the remedy this
        // page can already perform.
        force: false,
      }
      const resp = await fetch('/api/deck-sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await resp.json()) as DeckSyncRunResponse
      if (!data.success) {
        failRun(data.message, data.loginRequired)
        return
      }
      // One render for the whole report rather than one per deck.
      batch(() => {
        for (const result of data.report.decks) {
          updateDeck(result.name, (item) => ({
            ...item,
            status: result.status,
            messages: result.reason
              ? [...item.messages, { level: 'info', text: result.reason }]
              : item.messages,
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
    const only = changeFilterParam(changeFilter())
    if (only) params.set('only', only)
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

    stream = openSyncStream<DeckSyncEvent, DeckSyncDoneEvent, DeckSyncErrorEvent>(
      streamUrl(ignoreUnreadableLines),
      {
        progress: (event) => handleSyncEvent(event, ignoreUnreadableLines),
        done: (event) => finishRun(event?.message ?? 'Sync complete.'),
        failed: (event) =>
          failRun(event?.message ?? 'Failed to sync decks.', event?.loginRequired === true),
        disconnected: (received) => {
          stream = null
          if (received) {
            // The run is already in flight server-side; re-issuing it could push
            // a second time. Report the drop and let the user reload to see
            // where it landed.
            failRun('The connection dropped mid-sync. Reload to see how far the run got.', false)
            return
          }
          // Never connected: retry once over plain JSON so a proxy that buffers
          // server-sent events doesn't make the page unusable.
          void runWithoutStream(ignoreUnreadableLines)
        },
      },
    )
    // `EventSource` could not even be constructed — the same fallback applies.
    if (!stream) void runWithoutStream(ignoreUnreadableLines)
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

          <ChoicePicker
            heading="Direction"
            label="Sync direction"
            class="sync-direction"
            options={DIRECTIONS}
            value={direction()}
            onSelect={setDirection}
            disabled={running()}
          />

          <ChangeFilterPicker
            value={changeFilter()}
            onSelect={setChangeFilter}
            disabled={running()}
          />

          <h3 class="section-subheading">Decks</h3>
          <ul class="sync-select-list">
            <li class="sync-select-row sync-select-row--all">
              <label class="sync-select-label">
                <input
                  ref={trackIndeterminate}
                  type="checkbox"
                  checked={allSelected()}
                  disabled={running()}
                  onChange={toggleAll}
                />
                <span class="sync-select-name">All decks</span>
              </label>
              <span class="sync-select-meta">
                {selected().length} of {decks().length} selected
              </span>
            </li>
            <For each={decks()}>
              {(deck) => (
                <li class="sync-select-row">
                  <label class="sync-select-label">
                    <input
                      type="checkbox"
                      checked={isSelected(deck.slug)}
                      disabled={running()}
                      onChange={() => toggleDeck(deck.slug)}
                    />
                    <span class="sync-select-name">{deck.name}</span>
                  </label>
                  <span
                    class="sync-select-meta"
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
            <UnreadableLinesPanel
              sources={unreadable()}
              noun="deck"
              consequence={unreadableConsequence('deck', direction())}
              confirmLabel="Sync anyway and remove those lines"
              disabled={running()}
              onConfirm={() => handleSync(true)}
            />
          </Show>

          <SyncRunLog notes={runLog()} items={runDecks()} />
        </Show>
      </Show>
    </div>
  )
}
