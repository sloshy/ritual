/**
 * The bookkeeping a sync page does while a run streams in, shared by Sync Decks
 * and Sync Collection.
 *
 * Both pages watch the same shape of run: one row per thing being synced (a
 * deck, a collection list), each carrying a status and the log lines the engine
 * emitted for it, plus the lines that belong to the run rather than to any one
 * row. Nothing here touches the DOM or Solid, so it is testable on its own —
 * which matters, because Solid's effects do not run under `bun test` and the
 * pages themselves can only be exercised through Playwright.
 */

import { formatDuration } from '../../utils'
import { t } from '../../i18n/t'

/** How far a run has progressed; drives the button state and the result panel. */
export type SyncRunPhase = 'idle' | 'running' | 'done' | 'error'

/**
 * One row's live state. `running` is the page's own status — the engines only
 * report an outcome — held from the row's start event until its result arrives.
 */
export type SyncRunStatus = 'running' | 'synced' | 'skipped' | 'failed'

/** The severity both engines label their log lines with. */
export type SyncRunLevel = 'info' | 'warn' | 'error'

export type SyncRunMessage = { level: SyncRunLevel; text: string }

/** One deck or collection list, as the progress list shows it. */
export type SyncRunItem = {
  /** The name the engine reported, which is what the row is matched by. */
  name: string
  status: SyncRunStatus
  /** A short tally shown beside the name, e.g. `+2 added, -1 removed`. */
  meta?: string
  messages: SyncRunMessage[]
}

/**
 * Create or update one row, preserving arrival order — the order the engine
 * worked in, which is the order the user watched it happen.
 */
export function upsertRunItem(
  items: readonly SyncRunItem[],
  name: string,
  apply: (item: SyncRunItem) => SyncRunItem,
): SyncRunItem[] {
  const index = items.findIndex((item) => item.name === name)
  if (index === -1) {
    return [...items, apply({ name, status: 'running', messages: [] })]
  }
  const next = [...items]
  next[index] = apply(items[index]!)
  return next
}

/** Append a message to a row, as an updater for {@link upsertRunItem}. */
export function withMessage(message: SyncRunMessage): (item: SyncRunItem) => SyncRunItem {
  return (item) => ({ ...item, messages: [...item.messages, message] })
}

/** "2 hours ago", or null when the timestamp is missing or unreadable. */
export function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return null
  const elapsed = Date.now() - time
  // A clock skew (or a just-written timestamp) must not read as "in the future".
  return t('admin.sync.lastSyncedAgo', { duration: formatDuration(Math.max(elapsed, 0)) })
}

/** {@link relativeTime}, with the wording a never-synced row shows instead. */
export function lastSyncedLabel(iso: string | null): string {
  return relativeTime(iso) ?? t('admin.sync.neverSynced')
}
