import { type JSX, batch, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { ArchidektLoginStatus } from '../../../auth/interfaces'
import type {
  CollectionSyncDoneEvent,
  CollectionSyncErrorEvent,
  CollectionSyncList,
  CollectionSyncRequest,
  CollectionSyncRunResponse,
  CollectionSyncStatusResponse,
} from '../../api/collection-sync'
import type {
  CollectionSyncCsv,
  CollectionSyncEvent,
  CollectionSyncListResult,
  CollectionSyncReport,
  UnreadableList,
} from '../../../collection-sync/engine'
import { describeAmbiguousRemoval, type AmbiguousRemoval } from '../../../collection-sync/describe'
import { normalizeListName } from '../../../list-file-name'
import { unreadableConsequence, type SyncDirection } from '../../../sync-common'
import { AmbiguousRemovalsPanel, RemovalPriorityPicker } from '../components/AmbiguousRemovals'
import { ArchidektLoginForm, ArchidektSessionAlert } from '../components/ArchidektSession'
import { NavLink } from '../components/NavLink'
import { PageHeading } from '../components/PageHeading'
import { StatusAlerts } from '../components/StatusAlerts'
import {
  ChangeFilterPicker,
  ChoicePicker,
  changeFilterParam,
  type ChangeFilterChoice,
  type SyncChoice,
} from '../components/SyncControls'
import { CsvOutcomePanel, CsvUploadToggle } from '../components/SyncCsv'
import { SyncRunLog } from '../components/SyncRunLog'
import { UnreadableLinesPanel } from '../components/UnreadableLinesPanel'
import {
  relativeTime,
  upsertRunItem,
  withMessage,
  type SyncRunItem,
  type SyncRunMessage,
  type SyncRunPhase,
} from '../sync-run'
import { openSyncStream, type SyncStream } from '../sync-stream'

/**
 * Sync Collection — the browser form of `ritual collection-sync`.
 *
 * The page differs from Sync Decks in the two ways the feature itself does: an
 * Archidekt account has one collection while Ritual has many collection lists,
 * so a run is scoped to *all* of them or to a chosen few rather than matched
 * file-by-file; and a pull has to be told which list new cards belong in, since
 * only the user knows which binder a card that appeared remotely went into.
 */

const DIRECTIONS: SyncChoice<SyncDirection>[] = [
  {
    id: 'pull',
    label: 'Pull',
    description:
      'Archidekt → local. Adds copies your lists are missing to the target list below, and removes copies Archidekt no longer has. Removing only some of a printing’s copies when they are spread across several lists needs the removal priority below — which one lost it is otherwise unknowable, and a real run stops without writing anything.',
  },
  {
    id: 'push',
    label: 'Push',
    description:
      'Local → Archidekt. Creates, grows, trims, and deletes records in your Archidekt collection until it matches the lists in scope. Nothing is written locally.',
  },
]

/** Which local lists a run compares against the account's collection. */
type ScopeChoice = 'all' | 'lists'

const SCOPES: SyncChoice<ScopeChoice>[] = [
  {
    id: 'all',
    label: 'Whole collection',
    description:
      'Compare every collection list against your Archidekt collection, including lists created since this page loaded.',
  },
  {
    id: 'lists',
    label: 'Selected lists',
    description:
      'Compare only the lists you pick. The remote side is still your whole Archidekt collection, so cards that live only in the lists you left out read as missing — pair this with a change filter when the selection is not the whole story.',
  },
]

/** An option of the pull-target picker: the list a pull adds new cards to. */
type TargetOption = {
  /** The name sent as `into`, which the server resolves the way any list name is. */
  value: string
  label: string
}

/**
 * Whether two names would name the same list, folded exactly as the server folds
 * them — so a target configured as `Blue Binder` is recognized as the
 * `blue-binder` list rather than as a list that does not exist yet. The fold is
 * *imported*, not mirrored: `normalizeListName` lives in the browser-safe
 * `list-file-name.ts` precisely so this picker cannot drift from the resolver.
 */
function sameListTarget(a: string, b: string): boolean {
  return normalizeListName(a) === normalizeListName(b)
}

/** Whether an option stands for `name`, by the slug it sends or the heading it shows. */
function isTargetOption(option: TargetOption, name: string): boolean {
  return sameListTarget(option.value, name) || sameListTarget(option.label, name)
}

/** Whether a chosen target is still one the picker offers — a real list, or the configured one. */
function offeredTarget(
  chosen: string,
  lists: readonly CollectionSyncList[],
  pullTarget: string,
): boolean {
  if (sameListTarget(chosen, pullTarget)) return true
  return lists.some(
    (list) => sameListTarget(list.slug, chosen) || sameListTarget(list.name, chosen),
  )
}

/** A completed list's tally, shown beside its row. Nothing to say when it changed nothing. */
function resultMeta(result: CollectionSyncListResult): string | undefined {
  if (result.added === 0 && result.removed === 0) return undefined
  return `+${result.added} added, -${result.removed} removed`
}

export function CollectionSync(): JSX.Element {
  const [lists, setLists] = createSignal<CollectionSyncList[]>([])
  const [archidekt, setArchidekt] = createSignal<ArchidektLoginStatus | null>(null)
  const [lastSynced, setLastSynced] = createSignal<string | null>(null)
  const [pullTarget, setPullTarget] = createSignal('')
  // How many new printings a push would add one at a time; the server owns the
  // number, and the CSV control explains itself with it.
  const [csvThreshold, setCsvThreshold] = createSignal(0)
  const [loading, setLoading] = createSignal(true)
  const [loadError, setLoadError] = createSignal<string | null>(null)

  const [direction, setDirection] = createSignal<SyncDirection>('pull')
  const [scope, setScope] = createSignal<ScopeChoice>('all')
  const [changeFilter, setChangeFilter] = createSignal<ChangeFilterChoice>('all')
  const [selected, setSelected] = createSignal<string[]>([])
  const [into, setInto] = createSignal('')
  // The lists an ambiguous removal may take copies from, in priority order. The
  // browser cannot be prompted mid-run, so this is the only way a pull places
  // one — without it such a removal stops the run.
  const [removalPriority, setRemovalPriority] = createSignal<string[]>([])
  // How a push's new cards reach Archidekt. On by default: a browser cannot be
  // asked mid-run, and the alternative refuses outright above the threshold
  // rather than spending a search per card.
  const [csvUpload, setCsvUpload] = createSignal(true)
  const [dryRun, setDryRun] = createSignal(false)

  const [phase, setPhase] = createSignal<SyncRunPhase>('idle')
  const [runLists, setRunLists] = createSignal<SyncRunItem[]>([])
  const [runLog, setRunLog] = createSignal<SyncRunMessage[]>([])
  const [summary, setSummary] = createSignal<string | null>(null)
  const [runError, setRunError] = createSignal<string | null>(null)
  // Lists the last run refused to touch because their files hold lines the
  // parser cannot read; cleared when the user accepts the loss and re-runs.
  const [unreadable, setUnreadable] = createSignal<UnreadableList[]>([])
  // Removals the last run could not place — the run that therefore wrote
  // nothing. Empty when a removal priority placed them all.
  const [ambiguous, setAmbiguous] = createSignal<AmbiguousRemoval[]>([])
  // What the last run's CSV import did with a push's new cards; null when the run
  // did not take that path (every pull, and a push that added nothing new).
  const [csvOutcome, setCsvOutcome] = createSignal<CollectionSyncCsv | null>(null)

  let stream: SyncStream | null = null
  onCleanup(() => stream?.close())

  const loadStatus = async (): Promise<void> => {
    try {
      const resp = await fetch('/api/collection-sync', { credentials: 'same-origin' })
      if (!resp.ok) {
        setLoadError('Could not load collection lists.')
        return
      }
      const data = (await resp.json()) as CollectionSyncStatusResponse
      const slugs = data.lists.map((list) => list.slug)
      // One logical update, so the lists and the selection never render mismatched.
      batch(() => {
        setLists(data.lists)
        setArchidekt(data.archidekt)
        setLastSynced(data.lastSynced)
        setPullTarget(data.pullTarget)
        setCsvThreshold(data.csvThreshold)
        setLoadError(null)
        // A reload (after a run, or after signing in) keeps whatever the user
        // picked, minus lists that have since gone away.
        setSelected((current) => current.filter((slug) => slugs.includes(slug)))
        // Same for the priority: a list that is gone can hand over no copies,
        // and leaving it in would fail every later run on an unknown name.
        setRemovalPriority((current) => current.filter((slug) => slugs.includes(slug)))
        // The configured target seeds the picker, but never overrides a choice
        // the user has already made — unless that choice is gone (a renamed or
        // deleted list), which would otherwise leave the control showing one
        // destination while the next run used another.
        setInto((current) =>
          current === '' || !offeredTarget(current, data.lists, data.pullTarget)
            ? data.pullTarget
            : current,
        )
      })
    } catch {
      setLoadError('Could not load collection lists.')
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    void loadStatus()
  })

  const isSelected = (slug: string): boolean => selected().includes(slug)
  const loginRequired = (): boolean => archidekt()?.loginRequired !== false
  const running = (): boolean => phase() === 'running'
  /** A run needs somewhere to sync from: every list, or at least one chosen one. */
  const scopeEmpty = (): boolean => scope() === 'lists' && selected().length === 0

  const toggleList = (slug: string): void => {
    const deselecting = isSelected(slug)
    batch(() => {
      setSelected((current) =>
        deselecting ? current.filter((s) => s !== slug) : [...current, slug],
      )
      // A list the run no longer compares can hold no ambiguous copies, so
      // leaving it ranked would offer an answer that resolves nothing and fails
      // the run instead.
      if (deselecting) setRemovalPriority((current) => current.filter((s) => s !== slug))
    })
  }

  /** Narrowing the scope narrows the priority with it, for the same reason. */
  const chooseScope = (next: ScopeChoice): void => {
    batch(() => {
      setScope(next)
      if (next === 'lists') {
        setRemovalPriority((current) => current.filter((slug) => selected().includes(slug)))
      }
    })
  }

  /**
   * The lists an ambiguous removal could actually take copies from: the run's
   * scope. An ambiguity only arises between lists being compared, and a priority
   * naming a list outside the scope places nothing — which fails the whole run
   * with nothing written, having looked like a valid answer.
   */
  const priorityLists = createMemo((): CollectionSyncList[] =>
    scope() === 'lists' ? lists().filter((list) => selected().includes(list.slug)) : lists(),
  )

  /**
   * The lists a pull can add cards to: every collection list, plus the
   * configured target when no list answers to that name yet — a pull creates it
   * on first use, so offering it is not offering something impossible.
   */
  const targetOptions = createMemo((): TargetOption[] => {
    const options = lists().map((list): TargetOption => ({ value: list.slug, label: list.name }))
    const configured = pullTarget()
    // A target configured as "Blue Binder" is already offered by the
    // `blue-binder` row — the server folds case and separators the same way —
    // so matching only the raw slug would list it twice, once as a phantom new
    // list. `isChosenTarget` below has to ask the same question, or the control
    // shows one destination while the run uses another.
    const exists = options.some((option) => isTargetOption(option, configured))
    if (configured !== '' && !exists) {
      options.unshift({ value: configured, label: `${configured} (will be created)` })
    }
    return options
  })

  /** Whether an option is the list `name` asks for — the one `selected` marks. */
  const isChosenTarget = (option: TargetOption): boolean => isTargetOption(option, into())

  const actionLabel = createMemo(() => {
    const verb = dryRun() ? 'Preview' : direction() === 'pull' ? 'Pull' : 'Push'
    if (scope() === 'all') return `${verb} whole collection`
    const count = selected().length
    return `${verb} ${count} list${count === 1 ? '' : 's'}`
  })

  /** Create or update one list's row, preserving arrival order. */
  const updateList = (name: string, apply: (item: SyncRunItem) => SyncRunItem): void => {
    setRunLists((current) => upsertRunItem(current, name, apply))
  }

  /**
   * `confirmed` is the current run's answer to the unreadable-lines question.
   * The engine reports those lists on every run, confirmed or not, so a run the
   * user already approved must not re-raise the panel it was launched from.
   */
  const handleSyncEvent = (event: CollectionSyncEvent, confirmed: boolean): void => {
    switch (event.kind) {
      case 'list-start':
        updateList(event.list, (item) => ({ ...item, status: 'running' }))
        return
      case 'log': {
        const message: SyncRunMessage = { level: event.level, text: event.message }
        // A line with no list belongs to the run: the remote fetch, the change
        // filter's tally, removals that could not be placed.
        if (event.list === null) {
          setRunLog((current) => [...current, message])
          return
        }
        updateList(event.list, withMessage(message))
        return
      }
      case 'list-result':
        updateList(event.result.name, (item) => ({
          ...item,
          status: event.result.status,
          meta: resultMeta(event.result),
        }))
        return
      case 'unreadable-lines':
        // Held for the confirmation panel the run ends on — the browser's
        // equivalent of the CLI's prompt. Already-confirmed runs skip it: those
        // lines are being dropped on purpose.
        if (!confirmed) setUnreadable(event.lists)
        return
      default: {
        // Every event kind must be rendered somewhere; a new one is a compile error.
        const unhandled: never = event
        throw new Error(`Unhandled collection-sync event: ${JSON.stringify(unhandled)}`)
      }
    }
  }

  /**
   * Close out a finished run. Ambiguous removals are raised as a panel only when
   * the run also reported an error: a run whose removal priority placed them all
   * applied them like any other change, and has nothing to confess.
   *
   * A run that reported a run-level error completed but settled nothing — it
   * wrote no file at all — so its tally is shown as a failure rather than under
   * a green "Pulled …", which would announce a sync directly above the panel
   * saying nothing was written. A wholesale CSV failure is the same kind of
   * outcome without being a run-level error (the engine fails the lists whose
   * cards the import lost), so it demotes the summary too.
   */
  const finishRun = (message: string, report?: CollectionSyncReport): void => {
    const failed =
      report !== undefined && (report.errors.length > 0 || report.csv?.status === 'failed')
    batch(() => {
      setPhase(failed ? 'error' : 'done')
      if (failed) setRunError(message)
      else setSummary(message)
      if (failed) setAmbiguous(report.ambiguous)
      // Whether the new cards were uploaded, previewed, or lost to a failed
      // import is the one thing a push's per-list tallies cannot show.
      setCsvOutcome(report?.csv ?? null)
    })
    // Refresh the status so "last synced" — and any list a pull created —
    // reflects the run.
    void loadStatus()
  }

  const failRun = (message: string, needsLogin: boolean): void => {
    setPhase('error')
    setRunError(message)
    if (needsLogin) void loadStatus()
  }

  /** The lists a run is scoped to; empty means the whole collection, server-side. */
  const scopedLists = (): string[] => (scope() === 'lists' ? selected() : [])

  /** The removal priority as the request carries it; a push has no removals to place. */
  const scopedPriority = (): string[] => (direction() === 'pull' ? removalPriority() : [])

  /**
   * The `csv` flag as the request carries it: only a push creates records, and
   * only the asked-for case is sent — `false` and absent are the same run, and an
   * absent field keeps a pull's request to what a pull is about.
   */
  const csvRequested = (): true | undefined =>
    direction() === 'push' && csvUpload() ? true : undefined

  /** Sync without progress streaming, used when `EventSource` cannot connect. */
  const runWithoutStream = async (ignoreUnreadableLines: boolean): Promise<void> => {
    try {
      // Typed against the endpoint's own contract, so a renamed field is a
      // compile error here rather than a 400 at runtime.
      const body: CollectionSyncRequest = {
        direction: direction(),
        lists: scopedLists(),
        only: changeFilterParam(changeFilter()),
        // A push writes nothing locally, so it has no target to be told about.
        into: direction() === 'pull' ? into() : undefined,
        // Omitted when empty, so the request says "no strategy" rather than
        // naming an empty one.
        removalPriority: scopedPriority().length > 0 ? scopedPriority() : undefined,
        csv: csvRequested(),
        dryRun: dryRun(),
        ignoreUnreadableLines,
      }
      const resp = await fetch('/api/collection-sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await resp.json()) as CollectionSyncRunResponse
      if (!data.success) {
        failRun(data.message, data.loginRequired)
        return
      }
      // One render for the whole report rather than one per list.
      batch(() => {
        for (const result of data.report.lists) {
          updateList(result.name, (item) => ({
            ...item,
            status: result.status,
            meta: resultMeta(result),
            messages: result.reason
              ? [...item.messages, { level: 'info', text: result.reason }]
              : item.messages,
          }))
        }
        // This path never saw the run's own log lines, so the two things it
        // would otherwise silently drop are replayed from the report.
        // `report.ambiguous` is a census of what the planner found, not a list
        // of failures — a removal priority may well have placed them, and the
        // engine's "Removing … (removal priority)" line has no equivalent here.
        // So they are replayed only for the run that actually stopped on them,
        // which is the same signal the panel below uses.
        const unplaced = data.report.errors.length > 0 ? data.report.ambiguous : []
        setRunLog((current) => [
          ...current,
          ...data.report.errors.map((text): SyncRunMessage => ({ level: 'error', text })),
          ...unplaced.map(
            (entry): SyncRunMessage => ({
              level: 'warn',
              text: describeAmbiguousRemoval(entry),
            }),
          ),
        ])
        // The report carries the unreadable lists too, so this path offers the
        // same confirmation the streamed one does.
        if (!ignoreUnreadableLines) setUnreadable(data.report.unreadable)
      })
      finishRun(data.message, data.report)
    } catch {
      failRun('Failed to sync the collection.', false)
    }
  }

  const streamUrl = (ignoreUnreadableLines: boolean): string => {
    const params = new URLSearchParams({ direction: direction() })
    // No `list` params means "every collection list" server-side, which also
    // covers lists created since this page loaded.
    for (const slug of scopedLists()) params.append('list', slug)
    const only = changeFilterParam(changeFilter())
    if (only) params.set('only', only)
    if (direction() === 'pull' && into() !== '') params.set('into', into())
    // One param per list, appended in order: `getAll` on the server reads them
    // back in exactly this order, which is what makes it a priority.
    for (const slug of scopedPriority()) params.append('removalPriority', slug)
    if (csvRequested()) params.set('csv', 'true')
    if (dryRun()) params.set('dryRun', 'true')
    if (ignoreUnreadableLines) params.set('ignoreUnreadableLines', 'true')
    return `/api/collection-sync/stream?${params.toString()}`
  }

  /**
   * Start a run. `ignoreUnreadableLines` is the user's answer to the
   * confirmation panel — the browser's stand-in for the CLI's prompt — and is
   * false for the first attempt, so a list whose file has lines Ritual cannot
   * read is never rewritten (nor treated as the truth) without being shown first.
   */
  const handleSync = (ignoreUnreadableLines = false): void => {
    batch(() => {
      setPhase('running')
      setRunLists([])
      setRunLog([])
      setSummary(null)
      setRunError(null)
      setUnreadable([])
      setAmbiguous([])
      setCsvOutcome(null)
    })

    stream = openSyncStream<CollectionSyncEvent, CollectionSyncDoneEvent, CollectionSyncErrorEvent>(
      streamUrl(ignoreUnreadableLines),
      {
        progress: (event) => handleSyncEvent(event, ignoreUnreadableLines),
        done: (event) => finishRun(event?.message ?? 'Sync complete.', event?.report),
        failed: (event) =>
          failRun(
            event?.message ?? 'Failed to sync the collection.',
            event?.loginRequired === true,
          ),
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
      <PageHeading page="collection-sync" />
      <p class="page-desc">
        Sync your collection lists with the Archidekt collection of the signed-in account. Copies
        are matched by printing, finish, and condition; an account has one collection, so every list
        in scope is compared against it at once.
      </p>

      <Show when={!loading()} fallback={<p class="text-muted">Loading collection lists…</p>}>
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

        <p class="sync-last-run">
          Last synced:{' '}
          <span class="sync-last-run-value">
            {relativeTime(lastSynced()) ?? 'never — this account has not synced yet'}
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

        <ChoicePicker
          heading="Scope"
          label="Collection lists to sync"
          class="sync-scope"
          options={SCOPES}
          value={scope()}
          onSelect={chooseScope}
          disabled={running()}
        />

        <Show when={scope() === 'lists'}>
          <Show
            when={lists().length > 0}
            fallback={<p class="text-muted">No collection lists yet — there is nothing to pick.</p>}
          >
            <ul class="sync-select-list sync-scope-lists">
              <For each={lists()}>
                {(list) => (
                  <li class="sync-select-row">
                    <label class="sync-select-label">
                      <input
                        type="checkbox"
                        checked={isSelected(list.slug)}
                        disabled={running()}
                        onChange={() => toggleList(list.slug)}
                      />
                      <span class="sync-select-name">{list.name}</span>
                    </label>
                    <span class="sync-select-meta">{list.slug}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <ChangeFilterPicker
          value={changeFilter()}
          onSelect={setChangeFilter}
          disabled={running()}
        />

        {/* A push writes nothing locally, so it has nowhere to put anything. */}
        <Show when={direction() === 'pull'}>
          <h3 class="section-subheading">Add new cards to</h3>
          <p class="sync-choice-desc">
            A card that appeared on Archidekt belongs in <em>some</em> list and only you know which,
            so every addition lands in this one. It defaults to the{' '}
            <code>collectionSync.pullTarget</code> setting, and is created if it does not exist yet.
          </p>
          <select
            class="form-input sync-pull-target"
            aria-label="List a pull adds new cards to"
            disabled={running()}
            onChange={(e) => setInto(e.currentTarget.value)}
          >
            {/* Selected per option rather than through the <select>'s own value:
                every status reload rebuilds the option list, which would reset a
                value binding that only tracks `into()` — leaving the control
                naming one destination while the next run used another. */}
            <For each={targetOptions()}>
              {(option) => (
                <option value={option.value} selected={isChosenTarget(option)}>
                  {option.label}
                </option>
              )}
            </For>
          </select>

          {/* Only a pull removes local copies, so only a pull can meet an
              ambiguous one. */}
          <RemovalPriorityPicker
            lists={priorityLists()}
            value={removalPriority()}
            onChange={setRemovalPriority}
            disabled={running()}
            dryRun={dryRun()}
          />
        </Show>

        {/* Only a push creates records, so only a push has new cards to route. */}
        <Show when={direction() === 'push'}>
          <CsvUploadToggle
            value={csvUpload()}
            onChange={setCsvUpload}
            disabled={running()}
            threshold={csvThreshold()}
            dryRun={dryRun()}
          />
        </Show>

        <label class="sync-dry-run">
          <input
            type="checkbox"
            checked={dryRun()}
            disabled={running()}
            onChange={(e) => setDryRun(e.currentTarget.checked)}
          />
          Preview only — report what would change without writing files or touching Archidekt
        </label>

        {/* Held apart from the Archidekt session banner above, which is also an alert. */}
        <div class="sync-run-status">
          <StatusAlerts status={summary()} error={runError()} />
        </div>

        <button
          class="btn btn-primary btn-lg sync-run-btn"
          disabled={running() || loginRequired() || scopeEmpty()}
          onClick={() => handleSync()}
        >
          {running() ? 'Syncing…' : actionLabel()}
        </button>
        {/* Only when a login form is actually rendered above — a status that
            failed to load leaves the load error to explain the disabled button. */}
        <Show when={archidekt()?.loginRequired === true}>
          <p class="text-muted">
            Sign in to Archidekt above to sync, or manage the stored session on the{' '}
            <NavLink page="archidekt-login" class="sync-login-link">
              Archidekt Login
            </NavLink>{' '}
            page.
          </p>
        </Show>

        {/* What became of a push's new cards, which no per-list tally shows: the
            import covers every list at once, before the first list is reported. */}
        <Show when={csvOutcome()}>{(csv) => <CsvOutcomePanel csv={csv()} />}</Show>

        {/* The run stopped before writing anything because it could not tell
            which list lost a card; the priority control above is the answer. */}
        <Show when={ambiguous().length > 0}>
          <AmbiguousRemovalsPanel removals={ambiguous()} />
        </Show>

        {/* The browser's stand-in for the CLI's confirmation prompt: the run
            refused these lists, and re-running is the explicit yes. */}
        <Show when={unreadable().length > 0}>
          <UnreadableLinesPanel
            sources={unreadable()}
            noun="collection list"
            consequence={unreadableConsequence('collection', direction())}
            confirmLabel="Sync anyway and lose those lines"
            disabled={running()}
            onConfirm={() => handleSync(true)}
          />
        </Show>

        <SyncRunLog notes={runLog()} items={runLists()} />
      </Show>
    </div>
  )
}
