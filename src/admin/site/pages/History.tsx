import { type JSX, Show, For, createSignal, createMemo, onCleanup } from 'solid-js'
import { isValidIso8601 } from '../../../changelog-blocks'
import { useT, useTKey, useTSegments } from '../../../ui/i18n'
import { groupListsByType, listInfoId, type ListId } from '../list-grouping'
import { useHistorySession } from '../hooks/useHistorySession'
import { useNavigationGuard } from '../../../editor/navigation-guard'
import { StatusAlerts } from '../components/StatusAlerts'
import { ConfirmDialog } from '../../../ui/ConfirmDialog'
import { CombineSetDialog, type CombineCandidate } from '../components/CombineSetDialog'
import { TextPromptDialog } from '../../../editor/components/TextPromptDialog'
import { PageHeading } from '../components/PageHeading'

/** A queued confirmation prompt routed through the shared {@link ConfirmDialog}. */
type PendingConfirm = {
  title: string
  message: string
  confirmLabel: string
  destructive: boolean
  onConfirm: () => void
  /** Runs when the prompt is dismissed, for confirmations that undo something on refusal. */
  onCancel?: () => void
}

/** Strip the leading `- ` marker so a raw change line renders as a plain list item. */
function lineText(line: string): string {
  return line.replace(/^-\s+/, '')
}

export function History(): JSX.Element {
  const t = useT()
  const tKey = useTKey()
  const tSegments = useTSegments()
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
  // when there are unsaved edits; run it immediately otherwise. `onCancel` lets the
  // caller undo a navigation that already happened — the router restores the URL
  // when a Back/Forward is refused.
  const guardedNavigate = (proceed: () => void, onCancel?: () => void) => {
    if (!session.dirty()) {
      proceed()
      return
    }
    // A second attempt supersedes the first, which still has to undo whatever it
    // did to get here (the router restores the URL a refused Back moved off of).
    confirm()?.onCancel?.()
    setConfirm({
      title: t('admin.history.discardTitle'),
      message: t('admin.history.discardMessage'),
      confirmLabel: t('admin.history.discardConfirm'),
      destructive: true,
      onConfirm: () => {
        setConfirm(null)
        proceed()
      },
      onCancel,
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
      title: t('admin.history.rewriteTitle'),
      message: t('admin.history.rewriteMessage'),
      confirmLabel: t('admin.history.rewriteConfirm'),
      destructive: false,
      onConfirm: () => {
        setConfirm(null)
        collapseAll()
        session.rewriteWithDefaults()
      },
    })

  const requestDiscard = () =>
    setConfirm({
      title: t('admin.history.discardAllTitle'),
      message: t('admin.history.discardAllMessage'),
      confirmLabel: t('admin.history.discardConfirm'),
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
      <PageHeading page="history" />

      <div class="history-toolbar">
        <div class="deck-selector-container history-toolbar-select">
          <label class="deck-selector-label" for="history-list-select">
            {t('admin.history.selectorLabel')}
          </label>
          <select
            id="history-list-select"
            class="deck-selector"
            value={session.selectedId() ?? ''}
            onChange={onSelectChange}
          >
            <option value="">{t('admin.select.chooseList')}</option>
            <For each={listsByType()}>
              {(group) => (
                <optgroup label={tKey(group.labelKey)}>
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
              title={session.canRewrite() ? undefined : t('admin.history.rewriteDisabled')}
              onClick={requestRewrite}
            >
              🔄 {t('admin.history.rewriteButton')}
            </button>
            <button
              type="button"
              class="btn-changes"
              disabled={!session.canUndo()}
              onClick={doUndo}
            >
              {t('admin.history.undo')}
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
              {session.saving() ? t('admin.history.saving') : t('admin.history.save')}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              disabled={!session.dirty()}
              onClick={requestDiscard}
            >
              {t('admin.history.discard')}
            </button>
          </div>
        </Show>
      </div>

      <StatusAlerts status={session.status()} error={session.error()} />

      <Show
        when={session.loaded()}
        fallback={<p class="text-muted">{t('admin.history.loadingLists')}</p>}
      >
        <Show
          when={hasList()}
          fallback={<p class="text-muted history-empty">{t('admin.history.chooseList')}</p>}
        >
          <Show
            when={!session.detailLoading()}
            fallback={<p class="text-muted">{t('admin.history.loading')}</p>}
          >
            <Show when={showSummary()}>
              <p class="history-summary text-muted">
                {t('admin.history.summary', {
                  originalSets: session.originalSetCount(),
                  sets: session.sets().length,
                  originalLines: session.originalLineCount(),
                  lines: session.lineCount(),
                })}
              </p>
            </Show>

            <Show
              when={session.sets().length > 0}
              fallback={
                <p class="text-muted history-empty">
                  {t('admin.history.noHistory')}
                  {/* The button's own name sits mid-sentence and is bolded, so
                      the hint renders as segments and only that parameter gets
                      markup. */}
                  <Show when={session.canRewrite()}>
                    {' '}
                    <For
                      each={tSegments('admin.history.noHistoryHint', {
                        action: t('admin.history.rewriteButton'),
                      })}
                    >
                      {(segment) =>
                        segment.kind === 'param' ? <strong>{segment.value}</strong> : segment.value
                      }
                    </For>
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
                            {t('ui.count.changes', { count: set.lines.length })}
                          </span>
                        </button>
                        <div class="history-set-actions">
                          <button
                            type="button"
                            class="btn btn-secondary btn-xs"
                            disabled={session.sets().length < 2}
                            onClick={() => setCombineFor(index())}
                          >
                            {t('admin.history.combine')}
                          </button>
                          <button
                            type="button"
                            class="btn btn-secondary btn-xs"
                            onClick={() => setRetimeFor(index())}
                          >
                            {t('admin.history.editTime')}
                          </button>
                          <button
                            type="button"
                            class="btn btn-danger btn-xs"
                            onClick={() => doDelete(index())}
                          >
                            {t('admin.history.delete')}
                          </button>
                        </div>
                      </div>
                      <Show when={expanded().has(index())}>
                        <ul class="history-set-lines">
                          <For each={set.lines}>
                            {(line) => <li class="history-line">{lineText(line)}</li>}
                          </For>
                        </ul>
                        <Show when={(set.trailing?.length ?? 0) > 0}>
                          <ul class="history-set-trailing">
                            <For each={set.trailing}>
                              {(line) => <li class="history-trailing-line">{line}</li>}
                            </For>
                          </ul>
                        </Show>
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
        title={t('admin.history.retimeTitle')}
        label={t('admin.history.retimeLabel')}
        initialValue={retimeInitial()}
        confirmLabel={t('admin.history.retimeConfirm')}
        validate={(value) =>
          isValidIso8601(value.trim()) ? null : t('admin.history.retimeInvalid')
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
            onCancel={() => {
              const onCancel = c().onCancel
              setConfirm(null)
              onCancel?.()
            }}
          />
        )}
      </Show>
    </div>
  )
}
