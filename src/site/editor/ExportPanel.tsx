import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js'
import { type ChangeEvent, formatChange } from '../../change-event'
import { countLabel } from '../../editor/change-bundle'
import type { ListType } from '../../list-type'
import { LIST_TYPE_DISPLAY } from '../../list-type'
import { downloadTextFile } from './download'

/** A "download the updated list file" action (deck .txt, collection .md/.csv, etc.). */
export type ListFileExport = {
  label: string
  filename: string
  /** Built lazily so it reflects the latest edits when clicked. */
  build: () => string
  mime?: string
}

/** One list's pending edits, as offered by the export panel's scope picker. */
export type ExportListGroup = {
  kind: ListType
  slug: string
  name: string
  changes: ChangeEvent[]
}

/**
 * Which edits an export covers: the open list only, the lists that make up the
 * combined view currently being browsed, or every list edited this session.
 */
export type ExportScope = 'current' | 'combined' | 'all'

type ExportPanelProps = {
  open: boolean
  onClose: () => void
  /**
   * The list currently open in the editor, with its live pending changes, or
   * `null` when exporting off a list page (a combined view or a directory). When
   * null, the "This list" scope is shown disabled and the default scope is "all".
   */
  current: ExportListGroup | null
  /**
   * Every list with pending edits this session (including the current one).
   * Read when the panel opens; edits cannot change while the modal is up.
   */
  allGroups: () => ExportListGroup[]
  /**
   * When browsing a combined view, the edited member lists that make it up (the
   * intersection of the combined selection with the lists edited this session).
   * Returning `null`/`undefined` — i.e. not on a combined view — hides the
   * "Current lists" scope. Read when the panel opens.
   */
  combinedGroups?: () => ExportListGroup[] | null
  /**
   * Filename for the downloaded change-list JSON (current-list scope). Optional
   * because the "This list" scope is unreachable off a list page (no `current`);
   * falls back to {@link bundleFilename} if omitted.
   */
  jsonFilename?: string
  /** Filename for the downloaded multi-list bundle JSON (all-lists scope). */
  bundleFilename: string
  /** Filename for the downloaded combined-view bundle JSON (current-lists scope). */
  combinedFilename?: string
  /** Built lazily so it reflects the latest edits when clicked. */
  buildJson: (scope: ExportScope) => string
  /** Optional "download updated file" actions specific to the list type. */
  fileExports?: ListFileExport[]
  /** Persist the current edits to this browser (opt-in localStorage). */
  onSaveToBrowser?: () => void
  /** Remove any saved session for this list. */
  onClearSaved?: () => void
  /** Whether a saved session currently exists (shows the Clear action). */
  hasSavedSession?: boolean
}

/** The panel's point-in-time view of the session's edits, captured when it opens. */
type ExportSnapshot = {
  current: ExportListGroup | null
  all: ExportListGroup[]
  combined: ExportListGroup[] | null
}

/**
 * The public editor's "commit" surface. Instead of saving to a server, it lets the
 * visitor download or copy their edits: a change-list JSON (which can be imported
 * via the admin site or `ritual import-changes`) and/or an updated list file with
 * the edits applied. When other lists were also edited this session, a scope
 * toggle switches between exporting just the open list's changes and a bundle of
 * every list's changes, and the pending changes can be reviewed before exporting.
 */
export const ExportPanel: Component<ExportPanelProps> = (props) => {
  const [copied, setCopied] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [scope, setScope] = createSignal<ExportScope>('current')
  const [reviewOpen, setReviewOpen] = createSignal(false)
  // The edits shown by the panel are a snapshot taken when it opens: the modal
  // backdrop blocks further editing while it is up, and a point-in-time view keeps
  // the counts, review list, and scope default from shifting under the visitor.
  const [snapshot, setSnapshot] = createSignal<ExportSnapshot | null>(null)

  // Plain accessors projecting off the snapshot signal (which only changes on an
  // open transition) — no createMemo needed for these trivial reads.
  const currentGroup = (): ExportListGroup | null => snapshot()?.current ?? null
  const snapshotAllGroups = (): ExportListGroup[] => snapshot()?.all ?? []
  const snapshotCombinedGroups = (): ExportListGroup[] | null => snapshot()?.combined ?? null

  const hasCurrent = (): boolean => currentGroup() != null
  const isCombinedView = (): boolean => snapshotCombinedGroups() != null

  /** Whether any list other than the open one has edits (drives the scope picker). */
  const otherListsExist = (): boolean => {
    const c = currentGroup()
    return snapshotAllGroups().some((g) => !(c && g.kind === c.kind && g.slug === c.slug))
  }

  const currentCount = (): number => currentGroup()?.changes.length ?? 0
  const allCount = (): number => snapshotAllGroups().reduce((sum, g) => sum + g.changes.length, 0)
  const allListCount = (): number => snapshotAllGroups().length
  const combinedCount = (): number =>
    (snapshotCombinedGroups() ?? []).reduce((sum, g) => sum + g.changes.length, 0)
  const combinedListCount = (): number => (snapshotCombinedGroups() ?? []).length

  // The effective scope, guarding against a stale selection when the available
  // scopes change (e.g. "current" with no open list falls back to "all").
  const activeScope = createMemo((): ExportScope => {
    const s = scope()
    if (s === 'current' && !hasCurrent()) return 'all'
    if (s === 'combined' && !isCombinedView()) return 'all'
    return s
  })

  const scopeCount = (): number =>
    activeScope() === 'current'
      ? currentCount()
      : activeScope() === 'combined'
        ? combinedCount()
        : allCount()

  /** Whether to show the scope picker: off a list, or when there's an alternative. */
  const showScope = (): boolean => !hasCurrent() || otherListsExist() || isCombinedView()

  /** The list groups covered by the active scope, for the review section. */
  const scopedGroups = createMemo((): ExportListGroup[] => {
    const active = activeScope()
    if (active === 'current') {
      const current = currentGroup()
      return current && current.changes.length > 0 ? [current] : []
    }
    const groups = active === 'combined' ? (snapshotCombinedGroups() ?? []) : snapshotAllGroups()
    return groups.filter((g) => g.changes.length > 0)
  })

  // Snapshot the edits and reset the transient state on each open transition (and
  // only then — the panel must not reshuffle if a change count moves while it is
  // up). When the open list has no edits but other lists do, exporting them is the
  // only useful action — start on the all-lists scope so the visitor isn't staring
  // at "0 changes".
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        setCopied(false)
        setSaved(false)
        setReviewOpen(false)
        setSnapshot({
          current: props.current,
          all: props.allGroups(),
          combined: props.combinedGroups?.() ?? null,
        })
        // Off a list page there is no "this list" to export, so default to the
        // broadest scope; on a list, default to it unless it has no edits of its own.
        setScope(
          !hasCurrent() ? 'all' : currentCount() === 0 && otherListsExist() ? 'all' : 'current',
        )
      },
    ),
  )

  // Close on Escape, matching the site's other dialogs.
  createEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

  const downloadJson = () => {
    const filename =
      activeScope() === 'current'
        ? (props.jsonFilename ?? props.bundleFilename)
        : activeScope() === 'combined'
          ? (props.combinedFilename ?? props.bundleFilename)
          : props.bundleFilename
    downloadTextFile(filename, props.buildJson(activeScope()), 'application/json')
  }

  const copyJson = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.buildJson(activeScope()))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="export-panel-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose()
        }}
      >
        <div class="export-panel" role="dialog" aria-modal="true" aria-label="Export your edits">
          <div class="export-panel-header">
            <h3 class="export-panel-title">Export your edits</h3>
            <button
              type="button"
              class="export-panel-close"
              aria-label="Close"
              onClick={props.onClose}
            >
              ×
            </button>
          </div>

          <Show when={showScope()}>
            <div class="export-panel-scope" role="group" aria-label="Export scope">
              <button
                type="button"
                class="export-panel-scope-option"
                data-active={activeScope() === 'current'}
                aria-pressed={activeScope() === 'current'}
                disabled={!hasCurrent()}
                title={hasCurrent() ? undefined : 'Open a single list to export just its changes'}
                onClick={() => setScope('current')}
              >
                This list ({countLabel(currentCount(), 'change')})
              </button>
              <Show when={isCombinedView()}>
                <button
                  type="button"
                  class="export-panel-scope-option"
                  data-active={activeScope() === 'combined'}
                  aria-pressed={activeScope() === 'combined'}
                  onClick={() => setScope('combined')}
                >
                  Current lists ({countLabel(combinedCount(), 'change')})
                </button>
              </Show>
              <button
                type="button"
                class="export-panel-scope-option"
                data-active={activeScope() === 'all'}
                aria-pressed={activeScope() === 'all'}
                onClick={() => setScope('all')}
              >
                All lists ({countLabel(allCount(), 'change')})
              </button>
            </div>
          </Show>

          <p class="export-panel-count">
            <Switch fallback={<>Exporting {countLabel(currentCount(), 'change')}</>}>
              <Match when={activeScope() === 'all'}>
                Exporting {countLabel(allCount(), 'change')} across{' '}
                {countLabel(allListCount(), 'list')}
              </Match>
              <Match when={activeScope() === 'combined'}>
                Exporting {countLabel(combinedCount(), 'change')} across{' '}
                {countLabel(combinedListCount(), 'list')}
              </Match>
            </Switch>
          </p>

          <Show when={scopeCount() > 0}>
            <button
              type="button"
              class="btn btn-secondary export-panel-review-toggle"
              aria-expanded={reviewOpen()}
              onClick={() => setReviewOpen(!reviewOpen())}
            >
              {reviewOpen() ? 'Hide changes' : 'Review changes'}
            </button>
            <Show when={reviewOpen()}>
              <div class="export-panel-review" data-scope={activeScope()}>
                <For each={scopedGroups()}>
                  {(group) => (
                    <div class="export-panel-review-group">
                      <div class="export-panel-review-list">
                        {LIST_TYPE_DISPLAY[group.kind].icon} {group.name} —{' '}
                        {countLabel(group.changes.length, 'change')}
                      </div>
                      <ul class="export-panel-review-changes">
                        <For each={group.changes}>
                          {(change) => <li>{formatChange(change)}</li>}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <div class="export-panel-actions">
            <button
              type="button"
              class="btn btn-secondary"
              disabled={scopeCount() === 0}
              onClick={downloadJson}
            >
              Download change list (JSON)
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              disabled={scopeCount() === 0}
              onClick={() => void copyJson()}
            >
              {copied() ? 'Copied!' : 'Copy JSON'}
            </button>
            <For each={props.fileExports ?? []}>
              {(fx) => (
                <button
                  type="button"
                  class="btn btn-secondary"
                  onClick={() => downloadTextFile(fx.filename, fx.build(), fx.mime)}
                >
                  {fx.label}
                </button>
              )}
            </For>
          </div>

          <p class="export-panel-hint">
            Apply the JSON with the admin site's Import Changes page or{' '}
            <code>ritual import-changes</code>.
          </p>

          <Show when={props.onSaveToBrowser != null}>
            <div class="export-panel-persist">
              <div class="export-panel-actions">
                <button
                  type="button"
                  class="btn btn-secondary"
                  disabled={currentCount() === 0}
                  onClick={() => {
                    props.onSaveToBrowser?.()
                    setSaved(true)
                    setTimeout(() => setSaved(false), 2000)
                  }}
                >
                  {saved() ? 'Saved to browser ✓' : 'Save edits to this browser'}
                </button>
                <Show when={props.hasSavedSession}>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    onClick={() => props.onClearSaved?.()}
                  >
                    Clear saved edits
                  </button>
                </Show>
              </div>
              <p class="export-panel-hint">
                Saved only in this browser (localStorage) until you clear it — never uploaded.
              </p>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
