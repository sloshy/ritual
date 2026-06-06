import type { ChangeEvent } from '../change-event'
import { CHANGE_ACTIONS } from '../change-event'

/**
 * The exported/imported edit-session file. A public-site visitor edits a deck,
 * collection, or wanted list and exports this; it is later imported into the
 * admin editor as pending changes (re-targeted to the current card IDs). The
 * `format` marker guards against importing unrelated JSON, and `baseContentHash`
 * lets the importer warn when the underlying list has changed since export.
 */
export type ChangeFile = {
  /** Format marker + version. Bump only on incompatible shape changes. */
  format: 'ritual-change-file'
  version: 1
  /** Which list type these changes target. */
  kind: ChangeFileKind
  /** Slug of the source list (best-effort target hint for import). */
  slug: string
  /** Display name of the source list, for human-friendly import prompts. */
  name: string
  /** Content hash of the source list at export time, when known. */
  baseContentHash?: string
  /** ISO timestamp the file was exported. */
  exportedAt: string
  /** The ordered edit events to replay. */
  changes: ChangeEvent[]
}

export type ChangeFileKind = 'deck' | 'collection' | 'wanted'

const KINDS: readonly ChangeFileKind[] = ['deck', 'collection', 'wanted']

type BuildChangeFileInput = {
  kind: ChangeFileKind
  slug: string
  name: string
  changes: ChangeEvent[]
  baseContentHash?: string
  /** ISO timestamp; injected by the caller so this stays pure/testable. */
  exportedAt: string
}

/** Build a {@link ChangeFile} from an editor's current state. */
export function buildChangeFile(input: BuildChangeFileInput): ChangeFile {
  return {
    format: 'ritual-change-file',
    version: 1,
    kind: input.kind,
    slug: input.slug,
    name: input.name,
    baseContentHash: input.baseContentHash,
    exportedAt: input.exportedAt,
    changes: input.changes,
  }
}

/** Serialize a {@link ChangeFile} to pretty JSON suitable for download/clipboard. */
export function serializeChangeFile(file: ChangeFile): string {
  return JSON.stringify(file, null, 2)
}

/**
 * Parse and validate a {@link ChangeFile} from JSON text. Returns the file on
 * success or a human-readable error string describing why it was rejected — the
 * caller surfaces it to the importer. Card IDs/sets referenced by the changes are
 * NOT resolved here; re-targeting against the live list happens at import time.
 */
export function parseChangeFile(text: string): ChangeFile | string {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'Not valid JSON.'
  }
  if (typeof raw !== 'object' || raw === null) return 'Expected a JSON object.'
  const obj = raw as Record<string, unknown>
  if (obj.format !== 'ritual-change-file') {
    return 'Not a ritual change file (missing "format": "ritual-change-file").'
  }
  if (obj.version !== 1) return `Unsupported change-file version: ${String(obj.version)}.`
  if (typeof obj.kind !== 'string' || !KINDS.includes(obj.kind as ChangeFileKind)) {
    return `Invalid list kind: ${String(obj.kind)} (expected deck, collection, or wanted).`
  }
  if (typeof obj.slug !== 'string') return 'Missing or invalid "slug".'
  if (typeof obj.name !== 'string') return 'Missing or invalid "name".'
  if (obj.baseContentHash !== undefined && typeof obj.baseContentHash !== 'string') {
    return 'Invalid "baseContentHash".'
  }
  if (typeof obj.exportedAt !== 'string') return 'Missing or invalid "exportedAt".'
  if (!Array.isArray(obj.changes)) return 'Missing or invalid "changes" array.'
  for (const [i, change] of obj.changes.entries()) {
    if (typeof change !== 'object' || change === null) return `Change #${i + 1} is not an object.`
    const action = (change as Record<string, unknown>).action
    if (typeof action !== 'string' || !CHANGE_ACTIONS.includes(action as never)) {
      return `Change #${i + 1} has an unknown action: ${String(action)}.`
    }
  }
  return {
    format: 'ritual-change-file',
    version: 1,
    kind: obj.kind as ChangeFileKind,
    slug: obj.slug,
    name: obj.name,
    baseContentHash: obj.baseContentHash,
    exportedAt: obj.exportedAt,
    changes: obj.changes as ChangeEvent[],
  }
}
