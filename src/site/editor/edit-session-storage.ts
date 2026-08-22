import {
  type ChangeBundleList,
  bundleFromChangeGroups,
  listChangesFromBundle,
  parseChangeBundle,
  serializeChangeBundle,
} from '../../editor/change-bundle'
import { resolveKnownListSlug } from './list-slug-resolver'
import type { ListType } from '../../list-type'

/**
 * Opt-in persistence of a public edit session in the browser's localStorage.
 *
 * Edits are ephemeral by default — nothing is written here unless the visitor
 * explicitly clicks "Save to browser". A saved session is a one-list
 * {@link ChangeBundleList} wrapped in the same bundle envelope the Export panel
 * produces, so restoring reuses the editor's safe import (re-target) path. All
 * access is guarded: localStorage may be unavailable (SSR, private mode,
 * disabled) or throw on quota, and a stored value may be stale/corrupt — every
 * failure degrades to "no saved session".
 */
const KEY_PREFIX = 'ritual:site:edits'

/** The localStorage key a list's edit session is stored under. Exported for tests. */
export function editSessionKey(kind: ListType, slug: string): string {
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

/** Persist a list's pending edits under its slug. A no-op if storage fails. */
export function saveEditSession(list: ChangeBundleList, exportedAt: string): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(
      editSessionKey(list.kind, list.slug),
      serializeChangeBundle(bundleFromChangeGroups([list], exportedAt, resolveKnownListSlug)),
    )
  } catch {
    // Quota or serialization failure — nothing more we can do; stay ephemeral.
  }
}

/**
 * Load a previously saved session for a list. Returns the stored
 * {@link ChangeBundleList} — with its moves denormalized back into the editor's
 * `move-from` / `move-to` events — only when one exists and validates against
 * the expected kind/slug; otherwise null (missing, corrupt, or belonging to a
 * different list).
 */
export function loadEditSession(kind: ListType, slug: string): ChangeBundleList | null {
  const store = storage()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(editSessionKey(kind, slug))
  } catch {
    return null
  }
  if (raw === null) return null
  const parsed = parseChangeBundle(raw)
  if (typeof parsed === 'string') return null
  // Exact kind + slug on purpose (not `bundleRefMatches`): the storage key IS
  // the slug, so a saved session can only ever be this list's own.
  const list = parsed.lists.find((l) => l.kind === kind && l.slug === slug)
  if (!list) return null
  return { ...list, changes: listChangesFromBundle(parsed, list) ?? [] }
}

/** Whether a saved session exists for a list (without parsing it fully). */
export function hasEditSession(kind: ListType, slug: string): boolean {
  const store = storage()
  if (!store) return false
  try {
    return store.getItem(editSessionKey(kind, slug)) !== null
  } catch {
    return false
  }
}

/** Remove any saved session for a list. A no-op if storage fails. */
export function clearEditSession(kind: ListType, slug: string): void {
  const store = storage()
  if (!store) return
  try {
    store.removeItem(editSessionKey(kind, slug))
  } catch {
    // Ignore — best effort.
  }
}
