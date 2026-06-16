import type { ChangeEvent } from '../../change-event'
import {
  type ChangeFile,
  type ChangeFileKind,
  buildChangeFile,
  parseChangeFile,
  serializeChangeFile,
} from '../../editor/change-file'

/**
 * Opt-in persistence of a public edit session in the browser's localStorage.
 *
 * Edits are ephemeral by default — nothing is written here unless the visitor
 * explicitly clicks "Save to browser". A saved session is the same
 * {@link ChangeFile} that the Export panel produces, so restoring reuses the
 * editor's safe import (re-target) path. All access is guarded: localStorage may
 * be unavailable (SSR, private mode, disabled) or throw on quota, and a stored
 * value may be stale/corrupt — every failure degrades to "no saved session".
 */
const KEY_PREFIX = 'ritual:site:edits'

/** The localStorage key a list's edit session is stored under. Exported for tests. */
export function editSessionKey(kind: ChangeFileKind, slug: string): string {
  return `${KEY_PREFIX}:${kind}:${slug}`
}

/** The localStorage object, or null when it is unavailable. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Persist the change file for a list under its slug. A no-op if storage fails. */
export function saveEditSession(file: ChangeFile): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(editSessionKey(file.kind, file.slug), serializeChangeFile(file))
  } catch {
    // Quota or serialization failure — nothing more we can do; stay ephemeral.
  }
}

/**
 * Load a previously saved session for a list. Returns the parsed {@link ChangeFile}
 * only when one exists and validates against the expected kind/slug; otherwise null
 * (missing, corrupt, or belonging to a different list).
 */
export function loadEditSession(kind: ChangeFileKind, slug: string): ChangeFile | null {
  const store = storage()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(editSessionKey(kind, slug))
  } catch {
    return null
  }
  if (raw === null) return null
  const parsed = parseChangeFile(raw)
  if (typeof parsed === 'string') return null
  if (parsed.kind !== kind || parsed.slug !== slug) return null
  return parsed
}

/** Whether a saved session exists for a list (without parsing it fully). */
export function hasEditSession(kind: ChangeFileKind, slug: string): boolean {
  const store = storage()
  if (!store) return false
  try {
    return store.getItem(editSessionKey(kind, slug)) !== null
  } catch {
    return false
  }
}

/**
 * Append change events into a list's saved session, creating one if none exists.
 *
 * Backs the cross-list "Remove all selected" action for lists that are not the one
 * currently open in an editor: the removals are merged into that list's browser
 * session so they surface (via the restore prompt) the next time it is edited.
 */
export function appendChangesToSession(
  kind: ChangeFileKind,
  slug: string,
  name: string,
  changes: ChangeEvent[],
): void {
  if (changes.length === 0) return
  const existing = loadEditSession(kind, slug)
  const base =
    existing ??
    buildChangeFile({ kind, slug, name, changes: [], exportedAt: new Date().toISOString() })
  saveEditSession({ ...base, changes: [...base.changes, ...changes] })
}

/** Remove any saved session for a list. A no-op if storage fails. */
export function clearEditSession(kind: ChangeFileKind, slug: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(editSessionKey(kind, slug))
  } catch {
    // Ignore — best effort.
  }
}
