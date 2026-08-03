/**
 * When the account's collection last synced.
 *
 * Decks record `lastSynced` in their front matter, but collection lists have no
 * front matter and the link is account-level anyway (one Archidekt collection,
 * many local lists), so the timestamp lives in a small JSON file beside the
 * Archidekt token — `.logins/collection-sync.json`. The engine writes it after
 * a completed non-dry run; the status endpoint and CLI read it.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureLoginsDir, getLoginsDir } from '../logins-dir'

export type CollectionSyncState = {
  /** ISO timestamp of the last completed (non-dry) sync. */
  lastSynced: string
  /** The Archidekt user id that run synced against. */
  userId: number
  /** That account's username, as the collection response reported it. */
  username: string
}

/** Reads and records the account-level sync timestamp; injectable for tests. */
export interface CollectionSyncStateStore {
  read(): Promise<CollectionSyncState | null>
  write(state: CollectionSyncState): Promise<void>
}

/** The state file's path — beside the token store, whose directory is already private. */
export function collectionSyncStatePath(): string {
  return path.join(getLoginsDir(), 'collection-sync.json')
}

/**
 * Validate parsed JSON as a {@link CollectionSyncState}, returning the message
 * explaining what is wrong when it is not one.
 */
export function parseCollectionSyncState(raw: unknown): CollectionSyncState | string {
  if (typeof raw !== 'object' || raw === null) {
    return 'Collection sync state is not an object'
  }
  const record = raw as Record<string, unknown>
  const { lastSynced, userId, username } = record
  if (typeof lastSynced !== 'string' || lastSynced === '') {
    return "Collection sync state is missing a 'lastSynced' timestamp"
  }
  if (typeof userId !== 'number' || !Number.isInteger(userId)) {
    return "Collection sync state is missing a numeric 'userId'"
  }
  if (typeof username !== 'string') {
    return "Collection sync state is missing a 'username'"
  }
  return { lastSynced, userId, username }
}

/**
 * What the state file says, keeping "there is no file" apart from "the file is
 * there but unreadable".
 *
 * Both let a sync proceed, but they are different facts and a read-only status
 * view must not report the second as the first: "never synced" is a positive
 * claim, and a corrupt state file is precisely when the user needs to be told
 * that the record — not the sync — is what is missing.
 */
export type CollectionSyncStateRead =
  | { kind: 'none' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'state'; state: CollectionSyncState }

/** Read the state file, distinguishing an absent file from an unusable one. */
export async function readCollectionSyncStateFile(): Promise<CollectionSyncStateRead> {
  let content: string
  try {
    content = await fs.readFile(collectionSyncStatePath(), 'utf-8')
  } catch {
    return { kind: 'none' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { kind: 'unreadable', reason: 'the file is not valid JSON' }
  }
  const parsed = parseCollectionSyncState(raw)
  if (typeof parsed === 'string') return { kind: 'unreadable', reason: parsed }
  return { kind: 'state', state: parsed }
}

/**
 * The recorded sync state, or null when there is none usable. This is the shape
 * a sync run reads — it only needs the timestamp, and a file that is missing,
 * unreadable, or not valid state all mean "no recorded sync to build on". A
 * surface that *reports* the state uses {@link readCollectionSyncStateFile}.
 */
export async function readCollectionSyncState(): Promise<CollectionSyncState | null> {
  const read = await readCollectionSyncStateFile()
  return read.kind === 'state' ? read.state : null
}

/** Record a completed sync, creating the private logins directory if needed. */
export async function writeCollectionSyncState(state: CollectionSyncState): Promise<void> {
  await ensureLoginsDir()
  await fs.writeFile(collectionSyncStatePath(), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  })
}

/** The production state store: the JSON file beside the token store. */
export function createFileCollectionSyncStateStore(): CollectionSyncStateStore {
  return { read: readCollectionSyncState, write: writeCollectionSyncState }
}
