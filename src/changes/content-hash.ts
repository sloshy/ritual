import fs from 'node:fs/promises'

/**
 * Centralized SHA-256 content hashing for list files (collections, decks, wanted lists).
 *
 * Hashes are stored in sidecar `.sha256` files alongside the original `.md` file.
 * This avoids recomputing hashes on every request — the hash is read from disk
 * and only recomputed when a write occurs or the sidecar is missing.
 */

/** Derive the `.sha256` sidecar path from a `.md` file path. */
export function hashPath(filePath: string): string {
  return filePath + '.sha256'
}

/** Compute the SHA-256 hex digest of a string. */
export function computeHash(content: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(content)
  return hasher.digest('hex')
}

/**
 * How a list file's on-disk content relates to its `.sha256` sidecar:
 *
 * - `clean` — the sidecar matches, so Ritual itself last wrote this exact
 *   state and already recorded its changelog entries.
 * - `diverged` — a sidecar exists but does not match: the file holds an edit
 *   Ritual has not recorded.
 * - `missing` — no sidecar at all: Ritual has never written (or has never
 *   stamped) this file, so nothing about it has been recorded.
 *
 * `diverged` and `missing` are both "unrecorded" for reporting purposes; they
 * are kept apart so `detect-changes --verify` can say which of the two it saw.
 */
export type SidecarState = 'clean' | 'diverged' | 'missing'

/** A sidecar classification together with the digest it was decided by. */
export type SidecarClassification = {
  state: SidecarState
  /** SHA-256 of `content` — the value a stamp would write. */
  hash: string
}

/**
 * Classify `content` against the hash read from its sidecar, returning the
 * digest as well. Callers that go on to stamp the sidecar use this so the
 * state and the hash they write are provably the same pass over the content.
 * Pure.
 */
export function classifySidecarWithHash(
  content: string,
  storedHash: string | null,
): SidecarClassification {
  const hash = computeHash(content)
  if (storedHash === null) return { state: 'missing', hash }
  return { state: storedHash === hash ? 'clean' : 'diverged', hash }
}

/** Classify `content` against the hash read from its sidecar. Pure. */
export function classifySidecar(content: string, storedHash: string | null): SidecarState {
  return classifySidecarWithHash(content, storedHash).state
}

/**
 * Returns true when `storedHash` already reflects `content` — i.e. the sidecar
 * is up to date and the file hasn't been modified since Ritual last wrote it.
 *
 * A `null` storedHash (missing sidecar) is never considered current.
 */
export function isHashCurrent(content: string, storedHash: string | null): boolean {
  return classifySidecar(content, storedHash) === 'clean'
}

/**
 * Load the precomputed hash from the `.sha256` sidecar file.
 * Returns `null` if the sidecar doesn't exist or can't be read.
 */
export async function loadHash(filePath: string): Promise<string | null> {
  try {
    const hash = await fs.readFile(hashPath(filePath), 'utf-8')
    return hash.trim()
  } catch {
    return null
  }
}

/**
 * Save a hash to the `.sha256` sidecar file.
 */
export async function saveHash(filePath: string, hash: string): Promise<void> {
  await fs.writeFile(hashPath(filePath), hash + '\n')
}

/**
 * Whether Ritual itself last wrote this exact file state: the `.sha256` sidecar
 * exists and matches `content`. A false result means the file holds a hand edit
 * Ritual has not recorded yet — writers must not refresh the sidecar in that
 * case, or `detect-changes` would treat the file as already recorded and
 * drop the edit's changelog entries.
 */
export async function isRitualClean(filePath: string, content: string): Promise<boolean> {
  return isHashCurrent(content, await loadHash(filePath))
}

/**
 * Write file content and its hash sidecar atomically (as much as the FS allows).
 * Returns the new content hash.
 */
export async function writeFileWithHash(filePath: string, content: string): Promise<string> {
  const hash = computeHash(content)
  await fs.writeFile(filePath, content)
  await saveHash(filePath, hash)
  return hash
}

/**
 * Append content to a file and update its hash sidecar.
 * Reads the existing content, appends, writes, and saves the new hash.
 * Returns the new content hash.
 */
export async function appendFileWithHash(filePath: string, data: string): Promise<string> {
  let existing = ''
  try {
    existing = await fs.readFile(filePath, 'utf-8')
  } catch {
    // File may not exist yet
  }
  const newContent = existing + data
  return writeFileWithHash(filePath, newContent)
}
