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
import type { SyncEvent, SyncLogLevel, UnreadableSource } from '../../sync/common'
import type { ItemChangeLine } from '../../sync/describe'
import { pickMessage } from '../../api/result'
import type { SyncMessage, SyncText } from '../../sync/message'
import { t } from '../../i18n/t'

/** How far a run has progressed; drives the button state and the result panel. */
export type SyncRunPhase = 'idle' | 'running' | 'done' | 'error'

/**
 * One row's live state. `running` is the page's own status — the engines only
 * report an outcome — held from the row's start event until its result arrives.
 */
export type SyncRunStatus = 'running' | 'synced' | 'skipped' | 'failed'

/**
 * The severity both engines label their log lines with. The page shows every
 * level, `detail` included: it has the room the CLI's `--verbose` gate saves.
 */
export type SyncRunLevel = SyncLogLevel

/**
 * One line the run panel shows. `text` is held unrendered — the engine's whole
 * message (English plus key and params, so the English is there for a key
 * this bundle does not know), a reference the page built itself, or literal
 * text — and rendered in JSX (`useSyncText`), so the line follows the reader's
 * language and is relabelled when they switch it, finished runs included.
 */
export type SyncRunMessage = { level: SyncRunLevel; text: SyncMessage | SyncText }

/** One deck or collection list, as the progress list shows it. */
export type SyncRunItem = {
  /** The name the engine reported, which is what the row is matched by. */
  name: string
  status: SyncRunStatus
  /** A short tally shown beside the name, e.g. `+2 added, -1 removed` — rendered in JSX. */
  meta?: SyncText
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
  meta?: (result: TResult) => SyncText | undefined
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
      const message: SyncRunMessage = { level: event.level, text: pickMessage(event) }
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
      throw new Error(t('admin.app.unhandledSyncEvent', { event: JSON.stringify(unhandled) }))
    }
  }
}

/** Anything a change replay can fall back on: every change names its card. */
type NamedChange = { name: string }

/**
 * Word one change for a replay of a finished report. A change of a kind this
 * build does not know — a newer server's — reads as its card name rather than
 * failing the whole replay of a run that completed.
 */
export function replayDescribe<C extends NamedChange, A extends unknown[]>(
  describe: (change: C, ...rest: A) => SyncText,
): (change: C, ...rest: A) => SyncText {
  return (change, ...rest) => {
    try {
      return describe(change, ...rest)
    } catch {
      return change.name
    }
  }
}

/**
 * One finished item's messages, as the non-streaming fallback shows them: its
 * change lines (count, then cards) followed by its reason — the order the
 * stream logs them in.
 */
export function replayResultMessages(
  lines: readonly ItemChangeLine[],
  reason: SyncMessage | undefined,
): SyncRunMessage[] {
  return [
    ...lines.map((line): SyncRunMessage => ({ level: line.level, text: line.text })),
    ...(reason ? [{ level: 'info' as const, text: reason }] : []),
  ]
}
