import { type JSX, Show, For, createSignal, createMemo, onCleanup } from 'solid-js'
import { isValidIso8601 } from '../../../changelog-blocks'
import { groupListsByType, listInfoId, type ListId } from '../list-grouping'
import { useHistorySession } from '../hooks/useHistorySession'
import { useNavigationGuard } from '../navigation-guard'
import { StatusAlerts } from '../components/StatusAlerts'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CombineSetDialog, type CombineCandidate } from '../components/CombineSetDialog'
import { TextPromptDialog } from '../components/TextPromptDialog'

/** A queued confirmation prompt routed through the shared {@link ConfirmDialog}. */
type PendingConfirm = {
  title: string
  message: string
  confirmLabel: string
  destructive: boolean
  onConfirm: () => void
}

/** Strip the leading `- ` marker so a raw change line renders as a plain list item. */
function lineText(line: string): string {
  return line.replace(/^-\s+/, '')
}

export function History(): JSX.Element {
  const session = useHistorySession()
  const guard = useNavigationGuard()

  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set())
  const [confirm, setConfirm] = createSignal<PendingConfirm | null>(null)
  const [combineFor, setCombineFor] = createSignal<number | null>(null)
  const [retimeFor, setRetimeFor] = createSignal<number | null>(null)

  const collapseAll = () => setExpanded(new Set<number>())

  const toggleExpanded = (index: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  // Route a navigation (page change or list switch) through a discard confirmation
  // when there are unsaved edits; run it immediately otherwise.
  const guardedNavigate = (proceed: () => void) => {
    if (!session.dirty()) {
      proceed()
      return
    }
    setConfirm({
      title: 'Discard unsaved changes?',
      message: 'Your edits to this change history will be lost.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => {
        setConfirm(null)
        proceed()
      },
    })
  }

  // Expose this page's guard so leaving it (or the unload prompt) confirms first.
  onCleanup(guard.register({ attempt: guardedNavigate, isDirty: session.dirty }))

  const listsByType = createMemo(() => groupListsByType(session.lists()))

  const onSelectChange = (e: Event) => {
    const target = e.currentTarget as HTMLSelectElement
    const id: ListId | null = target.value || null
    if (id === session.selectedId()) return
    guardedNavigate(() => {
      collapseAll()
      session.selectList(id)
    })
    // If the switch was deferred for confirmation, revert the visible selection.
    if (session.selectedId() !== id) target.value = session.selectedId() ?? ''
  }

  const requestRewrite = () =>
    setConfirm({
      title: 'Rewrite with defaults?',
      message:
        'Replace all change sets with a single new set describing the list exactly as it stands now.',
      confirmLabel: 'Rewrite',
      destructive: false,
      onConfirm: () => {
        setConfirm(null)
        collapseAll()
        session.rewriteWithDefaults()
      },
    })

  const requestDiscard = () =>
    setConfirm({
      title: 'Discard all changes?',
      message: 'Revert to the change history as it was loaded.',
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => {
        setConfirm(null)
        collapseAll()
        session.discard()
      },
    })

  const doDelete = (index: number) => {
    collapseAll()
    session.deleteSet(index)
  }

  const doUndo = () => {
    collapseAll()
    session.undo()
  }

  const combineCandidates = createMemo<CombineCandidate[]>(() => {
    const target = combineFor()
    if (target === null) return []
    return session
      .sets()
      .map((s, index) => ({ index, timestamp: s.timestamp, changeCount: s.lines.length }))
      .filter((c) => c.index !== target)
  })

  const onCombineSelect = (otherIndex: number) => {
    const target = combineFor()
    if (target === null) return
    collapseAll()
    session.combineSets(target, otherIndex)
    setCombineFor(null)
  }

  const retimeInitial = createMemo(() => {
    const index = retimeFor()
    return index === null ? '' : (session.sets()[index]?.timestamp ?? '')
  })

  const onRetimeConfirm = (value: string) => {
    const index = retimeFor()
    if (index === null) return
    collapseAll()
    session.retimeSet(index, value.trim())
    setRetimeFor(null)
  }

  const hasList = createMemo(() => session.selectedList() !== null)
  const showSummary = createMemo(
    () => hasList() && (session.dirty() || session.sets().length !== session.originalSetCount()),
  )

  return (
    <div class="history-page">
      <h2 class="section-heading">Change History</h2>

      <div class="history-toolbar">
        <div class="deck-selector-container history-toolbar-select">
          <label class="deck-selector-label" for="history-list-select">
            Edit history for
          </label>
          <select
            id="history-list-select"
            class="deck-selector"
            value={session.selectedId() ?? ''}
            onChange={onSelectChange}
          >
            <option value="">— Choose a list —</option>
            <For each={listsByType()}>
              {(group) => (
                <optgroup label={group.label}>
                  <For each={group.lists}>
                    {(list) => <option value={listInfoId(list)}>{list.name}</option>}
                  </For>
                </optgroup>
              )}
            </For>
          </select>
        </div>

        <Show when={hasList()}>
          <div class="history-toolbar-actions">
            <button
              type="button"
              class="btn-defaults"
              disabled={!session.canRewrite()}
              title={
                session.canRewrite() ? undefined : 'The list is empty — nothing to rewrite from.'
              }
              onClick={requestRewrite}
            >
              🔄 Rewrite with defaults
            </button>
            <button
              type="button"
              class="btn-changes"
              disabled={!session.canUndo()}
              onClick={doUndo}
            >
              Undo
              <Show when={session.canUndo()}>
                <span class="changes-badge">{session.undoCount()}</span>
              </Show>
            </button>
            <button
              type="button"
              class="btn-save"
              disabled={!session.dirty() || session.saving()}
              onClick={() => void session.save()}
            >
              {session.saving() ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              class="btn-discard"
              disabled={!session.dirty()}
              onClick={requestDiscard}
            >
              Discard
            </button>
          </div>
        </Show>
      </div>

      <StatusAlerts status={session.status()} error={session.error()} />

      <Show when={session.loaded()} fallback={<p class="text-muted">Loading lists…</p>}>
        <Show
          when={hasList()}
          fallback={
            <p class="text-muted history-empty">Choose a list to edit its change history.</p>
          }
        >
          <Show when={!session.detailLoading()} fallback={<p class="text-muted">Loading…</p>}>
            <Show when={showSummary()}>
              <p class="history-summary text-muted">
                Change sets: {session.originalSetCount()} → {session.sets().length} · Change lines:{' '}
                {session.originalLineCount()} → {session.lineCount()}
              </p>
            </Show>

            <Show
              when={session.sets().length > 0}
              fallback={
                <p class="text-muted history-empty">
                  This list has no change history.
                  <Show when={session.canRewrite()}>
                    {' '}
                    Use <strong>Rewrite with defaults</strong> to generate one from its current
                    contents.
                  </Show>
                </p>
              }
            >
              <div class="history-sets">
                <For each={session.sets()}>
                  {(set, index) => (
                    <div class="history-set">
                      <div class="history-set-header">
                        <button
                          type="button"
                          class="history-set-main"
                          aria-expanded={expanded().has(index())}
                          onClick={() => toggleExpanded(index())}
                        >
                          <span class="history-set-caret">
                            {expanded().has(index()) ? '▾' : '▸'}
                          </span>
                          <span class="history-set-time">{set.timestamp}</span>
                          <span class="history-set-count">
                            {set.lines.length} change{set.lines.length === 1 ? '' : 's'}
                          </span>
                        </button>
                        <div class="history-set-actions">
                          <button
                            type="button"
                            class="btn btn-secondary btn-xs"
                            disabled={session.sets().length < 2}
                            onClick={() => setCombineFor(index())}
                          >
                            Combine
                          </button>
                          <button
                            type="button"
                            class="btn btn-secondary btn-xs"
                            onClick={() => setRetimeFor(index())}
                          >
                            Edit time
                          </button>
                          <button
                            type="button"
                            class="btn-discard btn-xs"
                            onClick={() => doDelete(index())}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <Show when={expanded().has(index())}>
                        <ul class="history-set-lines">
                          <For each={set.lines}>
                            {(line) => <li class="history-line">{lineText(line)}</li>}
                          </For>
                        </ul>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>

      <CombineSetDialog
        open={combineFor() !== null}
        targetTimestamp={
          combineFor() === null ? '' : (session.sets()[combineFor()!]?.timestamp ?? '')
        }
        candidates={combineCandidates()}
        onSelect={onCombineSelect}
        onCancel={() => setCombineFor(null)}
      />

      <TextPromptDialog
        open={retimeFor() !== null}
        title="Edit timestamp"
        label="New ISO-8601 timestamp"
        initialValue={retimeInitial()}
        confirmLabel="Update"
        validate={(value) =>
          isValidIso8601(value.trim())
            ? null
            : 'Must be a valid ISO-8601 timestamp (e.g. 2026-05-29T12:00:00.000Z).'
        }
        onConfirm={onRetimeConfirm}
        onCancel={() => setRetimeFor(null)}
      />

      <Show when={confirm()}>
        {(c) => (
          <ConfirmDialog
            open={true}
            title={c().title}
            message={c().message}
            confirmLabel={c().confirmLabel}
            destructive={c().destructive}
            onConfirm={c().onConfirm}
            onCancel={() => setConfirm(null)}
          />
        )}
      </Show>
    </div>
  )
}
