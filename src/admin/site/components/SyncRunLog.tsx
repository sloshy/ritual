import { type JSX, Index, Show } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { SyncRunItem, SyncRunMessage, SyncRunStatus } from '../sync-run'
import { useSyncText } from '../sync-text'

/**
 * The progress list both sync pages stream into: the run's own log lines
 * followed by one row per deck or collection list, each showing how it ended
 * and what the engine said about it.
 */

const RUN_ICONS: Record<SyncRunStatus, string> = {
  running: '⏳',
  synced: '✓',
  skipped: '⏭',
  failed: '✗',
}

type SyncRunLogProps = {
  /** Lines belonging to the run rather than to any one row. */
  notes: readonly SyncRunMessage[]
  items: readonly SyncRunItem[]
}

/**
 * `<Index>` rather than `<For>` throughout: rows and lines only ever append, in
 * order, and a run starts from empty — while every event replaces the row it
 * touches with a new object. Keyed by position, a replaced row updates in place
 * instead of remounting with all its lines, which on a long run would re-render
 * every line on every event.
 */
export function SyncRunLog(props: SyncRunLogProps): JSX.Element {
  const t = useT()
  const sync = useSyncText()
  return (
    <Show when={props.items.length > 0 || props.notes.length > 0}>
      <h3 class="section-subheading">{t('admin.sync.progress')}</h3>
      <ul class="sync-run">
        <Index each={props.notes}>
          {(message) => (
            <li class="sync-run-note" data-level={message().level}>
              {sync(message().text)}
            </li>
          )}
        </Index>
        <Index each={props.items}>
          {(item) => (
            <li class="sync-run-item" data-status={item().status}>
              <span class="sync-run-icon">{RUN_ICONS[item().status]}</span>
              <div class="sync-run-body">
                <span class="sync-run-name">{item().name}</span>
                <Index each={item().messages}>
                  {(message) => (
                    <span class="sync-run-message" data-level={message().level}>
                      {sync(message().text)}
                    </span>
                  )}
                </Index>
              </div>
              <Show when={item().meta}>
                {(meta) => <span class="sync-run-meta">{sync(meta())}</span>}
              </Show>
            </li>
          )}
        </Index>
      </ul>
    </Show>
  )
}
