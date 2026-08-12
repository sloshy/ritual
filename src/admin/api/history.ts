import { getErrorMessage } from '../../errors'
import { getBaseDir } from '../../base-dir'
import {
  isChangeLine,
  isSetHeaderLine,
  isValidIso8601,
  parseChangeSets,
  serializeChangeSets,
  sortNewestFirst,
  type ChangeSet,
} from '../../changelog-blocks'
import { isStringArray } from '../../json'
import {
  buildDefaultChangeLines,
  changesPathFor,
  loadListSnapshot,
} from '../../commands/history-helpers'
import { resolveListFile } from './list-info'
import { listSlug } from '../../list-info'
import { apiMessage, type ApiMessage } from './result'
import { autoCommitAndPush, apiError, badRequest, readJsonObjectBody } from './save-helpers'
import { parseListTarget } from './target'
import { MAX_LIST_BODY_SIZE } from '../validation'

export type HistoryLoadResponse = {
  success: true
  /** Everything before the first change set (e.g. `# Changelog for My Deck`). */
  header: string
  /** Change sets, newest first. */
  sets: ChangeSet[]
  /** Raw change lines describing the list's current state, for the rewrite action. */
  defaultLines: string[]
}
export type HistorySaveResponse = ApiMessage & { success: true; setCount: number }

/** Untrusted save body, validated before narrowing to `{ sets: ChangeSet[] }`. */
type RawSaveBody = { sets?: unknown }

/** Untrusted change-set item, validated before narrowing to `ChangeSet`. */
type RawChangeSet = { timestamp?: unknown; lines?: unknown; trailing?: unknown }

/** An embedded line break would smuggle extra lines past the per-line checks. */
function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value)
}

/**
 * GET /api/history/:type/:slug — the list's parsed change sets (newest first) plus
 * the raw change lines that the "rewrite with defaults" action would produce. The
 * change log is the only file read for its sets; the list file is read solely to
 * derive the default lines (best-effort — a parse failure yields no defaults).
 */
export async function handleHistoryLoad(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (typeof target === 'string') return apiError(target, 400)

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) return apiError(`List '${target.slug}' not found`, 404)

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
    return apiError(getErrorMessage(err), 500)
  }
}

/**
 * Parse the raw save body's `sets` into typed change sets, or return the message
 * explaining the refusal. A parser, per the project convention — the HTTP status
 * and envelope belong to the handler, not here.
 */
function parseSets(raw: RawSaveBody): ChangeSet[] | string {
  if (!Array.isArray(raw.sets)) return 'sets array is required'
  const sets: ChangeSet[] = []
  for (const item of raw.sets as unknown[]) {
    if (item === null || typeof item !== 'object') return 'Each change set must be an object'
    const { timestamp, lines, trailing } = item as RawChangeSet
    if (typeof timestamp !== 'string' || !isValidIso8601(timestamp.trim())) {
      return 'Each change set needs a valid ISO-8601 timestamp'
    }
    if (!isStringArray(lines)) return 'Each change set needs a lines array of strings'
    if (lines.length === 0) return 'Each change set must have at least one change line'
    // Lines are stored trimmed by parseChangeSets, and an embedded line break
    // would smuggle a fabricated header or change line past these checks.
    const trimmedLines = lines.map((l) => l.trim())
    if (!trimmedLines.every((l) => isChangeLine(l) && !hasLineBreak(l))) {
      return 'Every change line must start with "- " and be a single line'
    }
    // `trailing` carries a set's preserved hand-written prose. A line that looks
    // like a change line or a `## ` header would be re-parsed as one on the next
    // load, silently changing meaning — refuse rather than reinterpret.
    if (trailing !== undefined) {
      if (!isStringArray(trailing)) {
        return 'A change set trailing field must be an array of strings'
      }
      if (trailing.some(hasLineBreak)) return 'Trailing lines must each be a single line'
      if (trailing.some((l) => isChangeLine(l.trim()) || isSetHeaderLine(l.trim()))) {
        return 'Trailing lines must not look like change lines or "## " headers'
      }
    }
    sets.push({
      timestamp: timestamp.trim(),
      lines: trimmedLines,
      ...(trailing !== undefined && trailing.length > 0 ? { trailing } : {}),
    })
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
    const target = parseListTarget(req)
    if (typeof target === 'string') return apiError(target, 400)

    const parsedBody = await readJsonObjectBody(req, MAX_LIST_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const raw = parsedBody.body as unknown as RawSaveBody
    const sets = parseSets(raw)
    if (typeof sets === 'string') return badRequest(sets)

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) return apiError(`List '${target.slug}' not found`, 404)

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
      ...apiMessage('admin.api.history.saved', { count: sets.length }),
      setCount: sets.length,
    }
    return Response.json(body)
  } catch (err) {
    return apiError(getErrorMessage(err), 500)
  }
}
