/**
 * The reactive renderers for a sync's text on the admin sync pages.
 *
 * The engines hand every line and reason over as a message — English for
 * structured readers, plus the key and params (`src/sync/message.ts`) — and the
 * run's endpoints end with a summary of keyed clauses or a keyed error. The
 * pages hold all of it unrendered and render it here, in the reader's language
 * and through the i18n store's locale signal, so a language switch relabels a
 * run already on screen, finished or not.
 */

import { renderSyncSummary, type SyncSummary } from '../api/sync-summary'
import { pickMessage, type ApiMessage } from '../../api/result'
import { isMessageKey, type MessageTriple } from '../../i18n/t'
import { useI18n } from '../../ui/i18n'
import {
  renderSyncMessage,
  renderSyncParam,
  type SyncMessage,
  type SyncParam,
} from '../../sync/message'

/**
 * `const sync = useSyncText()` at the top of a component, then `sync(text)` in
 * JSX — for a whole message (whose English is the fallback for a key this
 * bundle does not know), a reference, literal text, or a list param.
 */
export function useSyncText(): (text: SyncMessage | SyncParam) => string {
  const { locale } = useI18n()
  return (text) =>
    typeof text === 'object' && 'message' in text
      ? renderSyncMessage(text, locale())
      : renderSyncParam(text, locale())
}

/**
 * What a sync page's result banner holds once a run ends: the run's summary
 * (keyed clauses), or a keyed message — the endpoint's refusal (whose params
 * may nest: an error the run raised, such as a cache lock's time-out), or the
 * page's own fallback (`admin.sync.complete`, `admin.sync.connectionDropped`,
 * …) built with `apiMessage`. Never rendered text, so it relabels like the rest.
 */
export type RunNotice = SyncSummary | SyncMessage

/**
 * Drop a key this bundle does not know (a newer server's), and its params, so
 * the text falls back to the English it was sent rather than printing the raw
 * key. Generic over the params, so a summary clause stays flat.
 */
export function withKnownKey<P>(message: MessageTriple<P>): MessageTriple<P> {
  if (message.messageKey === undefined || isMessageKey(message.messageKey)) return message
  return { message: message.message }
}

/** The message half of an event or response that carries one — with a known key only. */
export function noticeMessage<P>(source: MessageTriple<P>): MessageTriple<P> {
  return withKnownKey(pickMessage(source))
}

/** A run's `done` payload, as far as its banner cares. */
export type DoneMessage = ApiMessage & { summary?: SyncSummary }

/**
 * What a finished run's banner says: its keyed summary — or, from a server that
 * sent none, the message it did send.
 */
export function doneNotice(done: DoneMessage): RunNotice {
  return done.summary ?? noticeMessage(done)
}

/** `const notice = useRunNotice()`, then `notice(summary())` in JSX. */
export function useRunNotice(): (notice: RunNotice | null) => string | null {
  const { locale, tDynamic } = useI18n()
  return (notice) => {
    if (notice === null) return null
    if ('clauses' in notice) {
      // Each clause gated like any other message, so one unknown key cannot
      // print raw in the middle of the summary.
      const clauses = notice.clauses.map(noticeMessage)
      return renderSyncSummary(tDynamic, { clauses }, locale())
    }
    // The whole tree is checked: a nested key this bundle does not know sends
    // the banner back to the English it was sent.
    return renderSyncMessage(noticeMessage(notice), locale())
  }
}
