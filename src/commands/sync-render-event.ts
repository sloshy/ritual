/**
 * The console rendering of a sync run's events, shared by `deck-sync` and
 * `collection-sync`.
 *
 * Both commands print the same four lines from the same {@link SyncEvent}
 * union; only the noun in the unreadable-lines warning and the sentence naming
 * what accepting those lines costs differ, and both follow from the
 * {@link SyncSubjectKind}. One renderer is what keeps the indentation and the
 * wording from drifting between the two commands.
 */

import type { Logger } from '../util/logger'
import {
  unreadableConsequence,
  type SyncDirection,
  type SyncEvent,
  type SyncEventHandler,
  type SyncSubjectKind,
} from '../sync/common'
import { describeUnreadable, type ScopedIndenter, type UnreadableSubject } from './sync-helpers'
import { t } from '../i18n/t'

/** What each engine calls the things it syncs, in the unreadable-lines warning. */
const UNREADABLE_SUBJECT = {
  deck: 'decks',
  collection: 'collectionLists',
} as const satisfies Record<SyncSubjectKind, UnreadableSubject>

export type SyncEventRendererOptions = {
  /** Which engine is running, for the noun and the consequence sentence. */
  subject: SyncSubjectKind
  direction: SyncDirection
  logger: Logger
  indent: ScopedIndenter
}

/**
 * Render each sync event as a console line. Item-scoped messages are indented
 * under the `Syncing "…"` line that opened the deck or list — but only when that
 * line actually printed, and only after it did (see `createScopedIndenter`): the
 * per-line cache warnings arrive before any header exists, and `--quiet` drops
 * the headers entirely. Run-level messages (the remote fetch, ambiguous
 * removals, sources that could not be loaded at all) sit flush left. Results
 * themselves are not printed — the closing tally and the report summarize them.
 */
export function createSyncEventRenderer<TResult>({
  subject,
  direction,
  logger,
  indent,
}: SyncEventRendererOptions): SyncEventHandler<TResult> {
  return (event: SyncEvent<TResult>): void => {
    switch (event.kind) {
      case 'item-start':
        indent.start(event.item)
        logger.info(t('cli.sync.syncing', { name: event.item, direction }))
        return
      case 'log': {
        const line = indent.line(event.item, event.message)
        if (event.level === 'warn') logger.warn(line)
        else if (event.level === 'error') logger.error(line)
        else logger.info(line)
        return
      }
      case 'item-result':
        // Results are summarized by the closing tally rather than printed per item.
        return
      case 'unreadable-lines':
        logger.warn(
          describeUnreadable(
            event.items,
            UNREADABLE_SUBJECT[subject],
            unreadableConsequence(subject, direction),
          ),
        )
        return
      default: {
        // Every event kind must be rendered somewhere; a new one is a compile error.
        const unhandled: never = event
        throw new Error(`Unhandled sync event: ${JSON.stringify(unhandled)}`)
      }
    }
  }
}
