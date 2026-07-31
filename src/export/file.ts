import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../base-dir'
import { hasErrorCode } from '../errors'
import { sanitizeListFileName } from '../list-file-name'
import type { ListLocation } from '../resolve-list'
import { EXPORT_FORMAT_EXTENSIONS, type ExportFormat } from './presets'

/**
 * Server-written exports: where they land and what they are called.
 *
 * `POST /api/export` can write its render to a file instead of returning it
 * inline, for callers (agents, scripts) that would rather hand a path onward
 * than carry a whole CSV through a response. The server picks the name so no
 * caller can steer a write outside the workspace.
 */

/** The directory server-written exports land in, relative to the base dir. */
export const EXPORTS_DIR_NAME = 'exports'

/** The scope slug used when an export covers more than one list, or every list. */
const ALL_LISTS_SCOPE = 'all-lists'

/** The scope slug used when an export was assembled purely from card picks. */
const CARD_PICKS_SCOPE = 'cards'

/** Inputs the export filename is derived from. */
export type ExportFileNameInput = {
  /** The selected lists, when the caller named any. */
  lists: ListLocation[]
  /** Whether the request used card-pick terms. */
  hasCardPicks: boolean
  format: ExportFormat
  /** UTC instant the export was produced. */
  now: Date
  /** Names already present in the target directory. */
  existing: ReadonlySet<string>
}

/** A written export file, reported back to the caller. */
export type WrittenExport = {
  /** Base-dir-relative path, e.g. `exports/binder-20260728.csv`. */
  path: string
  absolutePath: string
  bytes: number
}

/** `YYYYMMDD` in UTC, so the same export produced anywhere is named the same. */
function utcDateStamp(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

/** The scope portion of the filename: the lone list's name, `cards`, or `all-lists`. */
function scopeSlug(lists: ListLocation[], hasCardPicks: boolean): string {
  if (lists.length === 1 && !hasCardPicks) {
    return sanitizeListFileName(lists[0]!.name) ?? ALL_LISTS_SCOPE
  }
  if (lists.length === 0 && hasCardPicks) return CARD_PICKS_SCOPE
  return ALL_LISTS_SCOPE
}

/**
 * `<scope>-<YYYYMMDD>.<ext>`, where scope is the single selected list's
 * sanitized name, `cards` for a card-pick-only export, or `all-lists`.
 * A name already in `existing` gains the lowest free `-N` suffix (from 2), so a
 * write never overwrites an earlier export. Pure: same inputs, same name.
 */
export function buildExportFileName(input: ExportFileNameInput): string {
  const ext = EXPORT_FORMAT_EXTENSIONS[input.format]
  const stem = `${scopeSlug(input.lists, input.hasCardPicks)}-${utcDateStamp(input.now)}`
  let candidate = `${stem}.${ext}`
  for (let n = 2; input.existing.has(candidate); n++) {
    candidate = `${stem}-${n}.${ext}`
  }
  return candidate
}

/** The file names already present under `<baseDir>/exports/` (empty when it does not exist). */
export async function listExistingExports(): Promise<Set<string>> {
  try {
    return new Set(await fs.readdir(path.join(getBaseDir(), EXPORTS_DIR_NAME)))
  } catch {
    return new Set()
  }
}

/**
 * How many names {@link writeExportFile} will try before giving up. Only a
 * concurrent writer can push past a handful; a bound keeps a pathological
 * directory from spinning forever.
 */
const MAX_NAME_ATTEMPTS = 100

/**
 * Write a rendered export under `<baseDir>/exports/`, creating the directory and
 * choosing the name itself via {@link buildExportFileName}. The content is
 * newline-terminated, matching what the CLI's `--out` writes, so a CLI-written
 * and an API-written export of the same selection are identical.
 *
 * The no-overwrite guarantee is enforced by the write, not by the directory
 * listing: an exclusive create (`wx`) fails rather than truncating, and the
 * collided name is folded into the candidate set for the next attempt. Picking a
 * free name from a snapshot and then writing plainly would leave a window in
 * which a concurrent export claims the name first.
 */
export async function writeExportFile(
  content: string,
  input: ExportFileNameInput,
): Promise<WrittenExport> {
  const dir = path.join(getBaseDir(), EXPORTS_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })
  const payload = `${content}\n`
  const taken = new Set(input.existing)

  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
    const name = buildExportFileName({ ...input, existing: taken })
    // The name is server-generated, but assert it before joining: a bare
    // basename is the whole reason no caller can steer a write out of `exports/`.
    if (name !== path.basename(name)) {
      throw new Error(`Refusing to write export under a non-basename name '${name}'.`)
    }
    const absolutePath = path.join(dir, name)
    try {
      await fs.writeFile(absolutePath, payload, { flag: 'wx' })
      return {
        path: `${EXPORTS_DIR_NAME}/${name}`,
        absolutePath,
        bytes: Buffer.byteLength(payload),
      }
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
      taken.add(name)
    }
  }

  throw new Error(
    `Could not find a free export file name after ${MAX_NAME_ATTEMPTS} attempts in ${dir}.`,
  )
}
