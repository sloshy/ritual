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

import { formatDuration } from '../../util/duration'
import type { SyncEvent, UnreadableSource } from '../../sync/common'
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

/** All the run panel reads from a result directly; `meta` projects the rest. */
export type SyncRunResult = { name: string; status: SyncRunStatus }

/** Where {@link applySyncEvent} puts each kind of event. */
export type ApplySyncEventOptions<TResult extends SyncRunResult> = {
  /** Create or update one row, as {@link upsertRunItem} does. */
  update: (name: string, apply: (item: SyncRunItem) => SyncRunItem) => void
  /** Record a line belonging to the run rather than to any one row. */
  appendLog: (message: SyncRunMessage) => void
  /** Hold the sources whose unreadable lines a run would drop, for the confirmation panel. */
  setUnreadable: (sources: UnreadableSource[]) => void
  /**
   * The current run's answer to the unreadable-lines question. The engines
   * report those sources on every run, confirmed or not, so a run the user
   * already approved must not re-raise the panel it was launched from.
   */
  confirmed: boolean
  /** A short tally to show beside the row, e.g. `+2 added, -1 removed`. */
  meta?: (result: TResult) => string | undefined
}

/**
 * Fold one streamed {@link SyncEvent} into a sync page's run state, so Sync
 * Decks and Sync Collection cannot disagree about which lines belong to a row,
 * when a row stops being `running`, or when the unreadable panel is raised.
 */
export function applySyncEvent<TResult extends SyncRunResult>(
  event: SyncEvent<TResult>,
  { update, appendLog, setUnreadable, confirmed, meta }: ApplySyncEventOptions<TResult>,
): void {
  switch (event.kind) {
    case 'item-start':
      update(event.item, (item) => ({ ...item, status: 'running' }))
      return
    case 'log': {
      const message: SyncRunMessage = { level: event.level, text: event.message }
      // A line with no item belongs to the run: the remote fetch, the change
      // filter's tally, removals that could not be placed.
      if (event.item === null) appendLog(message)
      else update(event.item, withMessage(message))
      return
    }
    case 'item-result':
      // A caller with no tally to show leaves the row's `meta` alone; one that
      // has a projection owns the field, including when it has nothing to say.
      update(event.result.name, (item) => ({
        ...item,
        status: event.result.status,
        meta: meta ? meta(event.result) : item.meta,
      }))
      return
    case 'unreadable-lines':
      // Held for the confirmation panel the run ends on — the CLI prompt's equivalent.
      if (!confirmed) setUnreadable(event.items)
      return
    default: {
      // Every event kind must be handled somewhere; a new one is a compile error.
      const unhandled: never = event
      throw new Error(`Unhandled sync event: ${JSON.stringify(unhandled)}`)
    }
  }
}
