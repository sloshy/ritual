import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import { isListType, type ListType } from '../../list-type'
import {
  isValidIso8601,
  parseChangeSets,
  serializeChangeSets,
  sortNewestFirst,
  type ChangeSet,
} from '../../changelog-blocks'
import {
  buildDefaultChangeLines,
  changesPathFor,
  loadListSnapshot,
} from '../../commands/history-helpers'
import { listSlug, loadListInfos, resolveListFile, type ListInfo } from './list-info'
import { validateBodySize, autoCommitAndPush } from './save-helpers'

export type HistoryListsResponse = { success: true; lists: ListInfo[] }
export type HistoryLoadResponse = {
  success: true
  /** Everything before the first change set (e.g. `# Changelog for My Deck`). */
  header: string
  /** Change sets, newest first. */
  sets: ChangeSet[]
  /** Raw change lines describing the list's current state, for the rewrite action. */
  defaultLines: string[]
}
export type HistorySaveResponse = { success: true; message: string; setCount: number }
export type HistoryErrorResponse = { success: false; message: string }

/** Untrusted save body, validated before narrowing to `{ sets: ChangeSet[] }`. */
type RawSaveBody = { sets?: unknown }

/** The validated `:type` / `:slug` path target shared by the load and save routes. */
type HistoryTarget = { type: ListType; slug: string }

const CHANGE_LINE = /^-\s+/

function error(message: string, status: number): Response {
  const body: HistoryErrorResponse = { success: false, message }
  return Response.json(body, { status })
}

/** Parse and validate the `:type` / `:slug` path segments shared by the load and save routes. */
function parseTarget(req: Request): HistoryTarget | Response {
  const parts = new URL(req.url).pathname.split('/')
  const rawType = parts[3]
  const rawSlug = parts[4]
  if (!rawType || !isListType(rawType)) return error('Invalid or missing list type', 400)
  if (!rawSlug) return error('List slug is required', 400)
  const slug = decodeURIComponent(rawSlug)
  // A slug is a single file basename; reject path separators / null bytes outright
  // (resolveListFile also guards traversal, but this gives a clearer 400).
  if (/[/\\\0]/.test(slug)) return error('Invalid list slug', 400)
  return { type: rawType, slug }
}

/** GET /api/history — every deck, collection, and wanted list as a slug-keyed summary. */
export async function handleHistoryLists(): Promise<Response> {
  try {
    const body: HistoryListsResponse = { success: true, lists: await loadListInfos() }
    return Response.json(body)
  } catch (err) {
    return error(getErrorMessage(err), 500)
  }
}

/**
 * GET /api/history/:type/:slug — the list's parsed change sets (newest first) plus
 * the raw change lines that the "rewrite with defaults" action would produce. The
 * change log is the only file read for its sets; the list file is read solely to
 * derive the default lines (best-effort — a parse failure yields no defaults).
 */
export async function handleHistoryLoad(req: Request): Promise<Response> {
  try {
    const target = parseTarget(req)
    if (target instanceof Response) return target

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) return error(`List '${target.slug}' not found`, 404)

    const changesPath = changesPathFor(filePath)
    let content = ''
    const changesFile = Bun.file(changesPath)
    if (await changesFile.exists()) content = await changesFile.text()
    const parsed = parseChangeSets(content, listSlug(filePath))

    let defaultLines: string[] = []
    try {
      defaultLines = buildDefaultChangeLines(await loadListSnapshot(target.type, filePath))
    } catch {
      // A list file that can't be parsed simply offers no default rewrite.
    }

    const body: HistoryLoadResponse = {
      success: true,
      header: parsed.header,
      sets: sortNewestFirst(parsed.sets),
      defaultLines,
    }
    return Response.json(body)
  } catch (err) {
    return error(getErrorMessage(err), 500)
  }
}

/** Validate the raw save body, returning typed sets or an error Response. */
function validateSets(raw: RawSaveBody): ChangeSet[] | Response {
  if (!Array.isArray(raw.sets)) return error('sets array is required', 400)
  const sets: ChangeSet[] = []
  for (const item of raw.sets as unknown[]) {
    if (item === null || typeof item !== 'object') {
      return error('Each change set must be an object', 400)
    }
    const { timestamp, lines } = item as Record<string, unknown>
    if (typeof timestamp !== 'string' || !isValidIso8601(timestamp.trim())) {
      return error('Each change set needs a valid ISO-8601 timestamp', 400)
    }
    if (!Array.isArray(lines) || !lines.every((l): l is string => typeof l === 'string')) {
      return error('Each change set needs a lines array of strings', 400)
    }
    if (lines.length === 0) {
      return error('Each change set must have at least one change line', 400)
    }
    if (!lines.every((l) => CHANGE_LINE.test(l))) {
      return error('Every change line must start with "- "', 400)
    }
    sets.push({ timestamp: timestamp.trim(), lines })
  }
  return sets
}

/**
 * POST /api/history/:type/:slug/save — overwrite the list's change log with the
 * supplied sets. Only the `.changes.md` file is written; the list's own `.md` is
 * never touched. The existing header is preserved (re-read from disk) so the
 * client can't rewrite it. Auto-commits the changelog like the editor endpoints.
 */
export async function handleHistorySave(req: Request): Promise<Response> {
  try {
    const tooLarge = validateBodySize(req)
    if (tooLarge) return tooLarge

    const target = parseTarget(req)
    if (target instanceof Response) return target

    const raw = (await req.json()) as RawSaveBody
    const sets = validateSets(raw)
    if (sets instanceof Response) return sets

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) return error(`List '${target.slug}' not found`, 404)

    const changesPath = changesPathFor(filePath)
    let existing = ''
    const changesFile = Bun.file(changesPath)
    if (await changesFile.exists()) existing = await changesFile.text()
    const { header } = parseChangeSets(existing, listSlug(filePath))

    await Bun.write(changesPath, serializeChangeSets({ header, sets }))
    await autoCommitAndPush(
      getBaseDir(),
      [changesPath],
      `Rewrite change history for ${listSlug(filePath)}`,
    )

    const body: HistorySaveResponse = {
      success: true,
      message: `Saved ${sets.length} change set${sets.length === 1 ? '' : 's'}.`,
      setCount: sets.length,
    }
    return Response.json(body)
  } catch (err) {
    return error(getErrorMessage(err), 500)
  }
}
