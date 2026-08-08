import { type JSX, For, Show } from 'solid-js'
import { useT } from '../../../ui/i18n'
import type { SyncRunItem, SyncRunMessage, SyncRunStatus } from '../sync-run'

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

export function SyncRunLog(props: SyncRunLogProps): JSX.Element {
  const t = useT()
  return (
    <Show when={props.items.length > 0 || props.notes.length > 0}>
      <h3 class="section-subheading">{t('admin.sync.progress')}</h3>
      <ul class="sync-run">
        <For each={props.notes}>
          {(message) => (
            <li class="sync-run-note" data-level={message.level}>
              {message.text}
            </li>
          )}
        </For>
        <For each={props.items}>
          {(item) => (
            <li class="sync-run-item" data-status={item.status}>
              <span class="sync-run-icon">{RUN_ICONS[item.status]}</span>
              <div class="sync-run-body">
                <span class="sync-run-name">{item.name}</span>
                <For each={item.messages}>
                  {(message) => (
                    <span class="sync-run-message" data-level={message.level}>
                      {message.text}
                    </span>
                  )}
                </For>
              </div>
              <Show when={item.meta}>{(meta) => <span class="sync-run-meta">{meta()}</span>}</Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  )
}
