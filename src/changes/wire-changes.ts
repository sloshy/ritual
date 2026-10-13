/**
 * Change events as they travel to a list's save route: the persisted fields
 * only, no `id` / `timestamp` envelope — and the save request around them.
 *
 * A save sends *what changed*, never the list itself — the route parses the
 * file, replays these events over it, and writes the result — so the events are
 * the whole request. The envelope is session bookkeeping (undo, move pairing);
 * the changelog never stores it and re-synthesizes it on read, so it is not
 * worth ~50 bytes per event on the wire. The route stamps a fresh one.
 *
 * Browser-safe and inside the persistence fence (no `src/i18n`): the admin
 * editor, the MCP mutations, the bundle importer and the save route all use it.
 */

import type { ChangeEvent, ChangeInput } from './change-event'
import { decodeChangeEvent, pickPersistedFields } from './change-event-decode'
import type { ListType } from '../list/list-type'
import { isRecord } from '../util/json'
import { MAX_SAVE_CHANGES } from './save-limits'
import { documentProblem, refuse, type ChangeProblemResult } from './change-problem'

/** An event in its wire form. */
export type WireChange = ChangeInput

/**
 * `POST /api/{deck|collection|wanted}/:slug/save` — what the client changed,
 * and nothing else. See `src/admin/api/list-save.ts` for what the route does
 * with it.
 */
export type ListSaveRequest = {
  /** Ordered events in their wire form; the route stamps the envelope. */
  changes: WireChange[]
  /**
   * The hash of the content the events were made against, from a full load. A
   * mismatch is a 409: someone else wrote the file since.
   */
  contentHash: string
  /** Merge into the session's existing changelog entry instead of a new one. */
  continueSession?: boolean
  /**
   * Refuse the save when a change names a card the local Scryfall cache does not
   * know. Off by default: the admin UI only ever sends names it read from a
   * list, and the check needs a warm cache.
   */
  validateCardNames?: boolean
}

/** The save route's path for one list. */
export function listSavePath(type: ListType, slug: string): string {
  return `/api/${type}/${encodeURIComponent(slug)}/save`
}

/** The event with its session envelope taken off, ready to post. */
export function toWireChange(event: ChangeEvent): WireChange {
  const { id: _id, timestamp: _timestamp, ...wire } = event
  return wire
}

/** A save request for `events`, in wire form. */
export function listSaveRequest(
  events: readonly ChangeEvent[],
  contentHash: string,
  options: Omit<ListSaveRequest, 'changes' | 'contentHash'> = {},
): ListSaveRequest {
  return { changes: events.map(toWireChange), contentHash, ...options }
}

/** {@link decodeWireChanges}' outcome: the stamped events, or why the batch was refused. */
export type WireChangesResult = ChangeProblemResult<ChangeEvent[]>

/**
 * Validate a save request's `changes` and stamp each with a fresh envelope.
 *
 * Every event goes through {@link decodeChangeEvent} — the same decoder the
 * changelog reader and the bundle importer use — so a save is held to the file
 * format's own rules (closed vocabularies, label sets per list type, tag and
 * category grammar, no line breaks) in one place. Only the persisted fields are
 * kept: an envelope the client sent anyway is replaced (ids must be unique
 * within the batch and timestamps ordered, because the cross-list move pairing
 * keys on both), and any other key is dropped before it can steer a reducer.
 *
 * @param raw The request's `changes` field, unvalidated.
 * @param listType The list the events land in, for the label check.
 * @param stampedAt Epoch ms the envelope's ids and timestamps derive from.
 */
export function decodeWireChanges(
  raw: unknown,
  listType: ListType,
  stampedAt: number,
): WireChangesResult {
  if (!Array.isArray(raw)) {
    return refuse(documentProblem('save-changes-not-array'))
  }
  const items: readonly unknown[] = raw
  if (items.length > MAX_SAVE_CHANGES) {
    return refuse(
      documentProblem('save-too-many', { count: MAX_SAVE_CHANGES, received: items.length }),
    )
  }
  const changes: ChangeEvent[] = []
  for (const [index, item] of items.entries()) {
    const stamped = isRecord(item)
      ? { ...pickPersistedFields(item), id: `${stampedAt}-${index}`, timestamp: stampedAt + index }
      : item
    const decoded = decodeChangeEvent(stamped, { kind: 'save-change', index }, { listType })
    if (!decoded.ok) return decoded
    changes.push(decoded.value)
  }
  return { ok: true, value: changes }
}
