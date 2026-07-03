import type { ChangeEvent } from '../../change-event'
import type { ListType } from '../../list-type'

/** One list's remembered pending edits (plus its display name, for export labels). */
type EditSession = {
  name: string
  changes: ChangeEvent[]
}

/** A list's remembered session, as surfaced by {@link listEditSessions}. */
export type EditSessionSnapshot = {
  kind: ListType
  slug: string
  name: string
  changes: ChangeEvent[]
}

/**
 * In-memory store of each list's pending edits for the current page session.
 *
 * Where {@link './edit-session-storage'} is opt-in localStorage that survives a
 * reload, this is plain module state that lives only as long as the page. It backs
 * persistent edit mode: a visitor's edits to one list survive navigating to another
 * list and back while edit mode stays on. The open editor mirrors its live changes
 * here and restores them on remount; the cross-list "Remove all selected" appends to
 * lists that are not currently open in an editor. Turning edit mode off clears every
 * session, and a reload drops them all (edit mode itself does not survive a reload).
 */
const sessions = new Map<string, EditSession>()

const keyOf = (kind: ListType, slug: string): string => `${kind}:${slug}`

/** Replace a list's remembered pending edits with the current change list. */
export function rememberEditSession(
  kind: ListType,
  slug: string,
  name: string,
  changes: ChangeEvent[],
): void {
  sessions.set(keyOf(kind, slug), { name, changes: [...changes] })
}

/**
 * The pending edits remembered for a list this session, or undefined if the list
 * has not been opened in an editor (nor targeted by a cross-list removal) yet. An
 * empty array means the list was opened but currently has no edits.
 */
export function recallEditSession(kind: ListType, slug: string): ChangeEvent[] | undefined {
  return sessions.get(keyOf(kind, slug))?.changes
}

/**
 * Append changes onto a list's remembered session, creating one if none exists.
 * Used by the cross-list "Remove all selected" for lists that are not the one
 * currently open in an editor, so the removals apply when that list is next opened.
 */
export function appendEditSession(
  kind: ListType,
  slug: string,
  name: string,
  changes: ChangeEvent[],
): void {
  if (changes.length === 0) return
  const existing = sessions.get(keyOf(kind, slug))
  sessions.set(keyOf(kind, slug), {
    name,
    changes: [...(existing?.changes ?? []), ...changes],
  })
}

/** Whether any remembered session currently holds at least one pending edit. */
export function hasAnyEditSession(): boolean {
  for (const session of sessions.values()) {
    if (session.changes.length > 0) return true
  }
  return false
}

/**
 * Every remembered session that currently holds at least one pending edit, in
 * insertion order. Backs the export panel's "all lists" scope, so the visitor can
 * export the edits accumulated across every list touched this session.
 */
export function listEditSessions(): EditSessionSnapshot[] {
  const snapshots: EditSessionSnapshot[] = []
  for (const [key, session] of sessions) {
    if (session.changes.length === 0) continue
    const separator = key.indexOf(':')
    snapshots.push({
      kind: key.slice(0, separator) as ListType,
      slug: key.slice(separator + 1),
      name: session.name,
      changes: [...session.changes],
    })
  }
  return snapshots
}

/** Forget every remembered session — called when edit mode is turned off. */
export function clearEditSessions(): void {
  sessions.clear()
}

/**
 * Whether leaving edit mode may proceed, prompting to confirm only when edits would
 * be lost. Because edits to other lists this session also persist in memory, the
 * confirm fires when the current list has pending changes OR any other session does
 * — not just the list currently open. Shared by every public list editor's exit.
 */
export function confirmDiscardOnExit(currentChangeCount: number): boolean {
  if (currentChangeCount === 0 && !hasAnyEditSession()) return true
  return window.confirm('Discard your edits and exit?')
}
